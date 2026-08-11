import json, sqlite3, os, sys, shutil, datetime

def backup(db_path, out_dir, label):
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # 1. Full SQLite file copy
    sqlite_backup = os.path.join(out_dir, f"{label}_full_{ts}.sqlite")
    shutil.copy2(db_path, sqlite_backup)
    print(f"[{label}] SQLite backup: {sqlite_backup}")

    # 2. JSON export of question data
    backup_data = {"exported_at": datetime.datetime.now().isoformat(), "topics": [], "constants": []}

    # Constants
    for row in conn.execute("SELECT name, symbol, value, unit, is_builtin, formula FROM constants ORDER BY symbol"):
        c = {"name": row["name"], "symbol": row["symbol"], "value": row["value"],
             "unit": row["unit"], "isBuiltin": bool(row["is_builtin"])}
        if row["formula"]:
            c["formula"] = row["formula"]
        backup_data["constants"].append(c)

    # Topics with categories, sets, templates, variables, equations, constraints
    for topic in conn.execute("SELECT id, name, created_at, for_students FROM topics WHERE name != 'Default' ORDER BY name"):
        topic_id = topic["id"]
        topic_data = {
            "name": topic["name"],
            "createdAt": topic["created_at"],
            "forStudents": bool(topic["for_students"]),
            "categories": [],
        }

        for cat in conn.execute("SELECT id, point_value FROM categories WHERE topic_id = ? ORDER BY point_value", (topic_id,)):
            cat_data = {"pointValue": cat["point_value"], "sets": []}

            for s in conn.execute("SELECT id, set_index, mode, name FROM sets WHERE category_id = ? ORDER BY set_index", (cat["id"],)):
                set_data = {"setIndex": s["set_index"], "mode": s["mode"], "questions": []}
                if s["name"]:
                    set_data["name"] = s["name"]

                for st in conn.execute("SELECT template_id, sort_order FROM set_templates WHERE set_id = ? ORDER BY sort_order", (s["id"],)):
                    t = conn.execute(
                        "SELECT question_text, formula, equation_text, numeric_answer, result_unit, point_value, significant_digits, created_at FROM templates WHERE id = ?",
                        (st["template_id"],)
                    ).fetchone()
                    if not t:
                        continue

                    q = {
                        "questionText": t["question_text"],
                        "formula": t["formula"],
                        "equationText": t["equation_text"],
                        "resultUnit": t["result_unit"],
                        "pointValue": t["point_value"],
                        "sortOrder": st["sort_order"],
                        "variables": [],
                    }
                    if t["numeric_answer"] is not None:
                        q["numericAnswer"] = t["numeric_answer"]
                    if t["significant_digits"] is not None:
                        q["significantDigits"] = t["significant_digits"]

                    # Variables
                    for tv in conn.execute(
                        "SELECT v.symbol, v.name, v.var_type, v.min_value, v.max_value, v.step, v.unit, v.precision, v.string_values, tv.placeholder, tv.greater_than_variable_id, tv.less_than_variable_id FROM template_variables tv JOIN variables v ON v.id = tv.variable_id WHERE tv.template_id = ?",
                        (st["template_id"],)
                    ):
                        var = {
                            "symbol": tv["symbol"],
                            "name": tv["name"],
                            "varType": tv["var_type"],
                            "minValue": tv["min_value"],
                            "maxValue": tv["max_value"],
                            "step": tv["step"],
                            "unit": tv["unit"],
                            "precision": tv["precision"],
                            "placeholder": tv["placeholder"],
                        }
                        if tv["string_values"]:
                            var["stringValues"] = json.loads(tv["string_values"])
                        if tv["greater_than_variable_id"]:
                            var["greaterThanVariableId"] = str(uuid_bytes_to_str(tv["greater_than_variable_id"]))
                        if tv["less_than_variable_id"]:
                            var["lessThanVariableId"] = str(uuid_bytes_to_str(tv["less_than_variable_id"]))
                        q["variables"].append(var)

                    # Constants linked to template
                    tc_rows = conn.execute("SELECT c.symbol, c.value FROM template_constants tc JOIN constants c ON c.id = tc.constant_id WHERE tc.template_id = ?", (st["template_id"],)).fetchall()
                    if tc_rows:
                        q["constants"] = [{"symbol": r["symbol"], "value": r["value"]} for r in tc_rows]

                    # Result constraints
                    rc = conn.execute("SELECT min_result, max_result, sd_allowed, constraint_type FROM result_constraints WHERE template_id = ?", (st["template_id"],)).fetchone()
                    if rc:
                        q["constraint"] = {
                            "minResult": rc["min_result"],
                            "maxResult": rc["max_result"],
                            "sdAllowed": rc["sd_allowed"],
                            "constraintType": rc["constraint_type"],
                        }

                    set_data["questions"].append(q)

                cat_data["sets"].append(set_data)
            topic_data["categories"].append(cat_data)
        backup_data["topics"].append(topic_data)

    conn.close()

    json_backup = os.path.join(out_dir, f"{label}_questions_{ts}.json")
    with open(json_backup, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, ensure_ascii=False, indent=2)

    topic_count = len(backup_data["topics"])
    q_count = sum(len(s["questions"]) for t in backup_data["topics"] for c in t["categories"] for s in c["sets"])
    const_count = len(backup_data["constants"])
    print(f"[{label}] JSON backup: {json_backup}")
    print(f"  {topic_count} topics, {q_count} questions, {const_count} constants")

def uuid_bytes_to_str(b):
    if b is None:
        return None
    import uuid
    return str(uuid.UUID(bytes=b))

if __name__ == "__main__":
    db_path = sys.argv[1]
    out_dir = sys.argv[2]
    label = sys.argv[3]
    backup(db_path, out_dir, label)
