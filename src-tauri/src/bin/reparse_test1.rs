/// Standalone binary that reparses test1_parsed.json using the new
/// `extract_variables` function to filter out chemical-formula subscripts
/// (e.g. H2SO4, AgNO3, Na2SO3.7H2O) and recomputes `numeric_answer` from
/// `answer_text` using the same parser.
use biochemcalc_lib::engine::extract_variables;
use serde_json::Value;

const JSON_PATH: &str = "/Users/kowalski/plato/vypocty/test1_parsed.json";

fn main() {
    let raw = std::fs::read_to_string(JSON_PATH).expect("Failed to read test1_parsed.json");
    let mut root: Value = serde_json::from_str(&raw).expect("Invalid JSON");

    let topics = root["topics"]
        .as_array_mut()
        .expect("topics is not an array");

    for topic in topics {
        let point_values = topic["point_values"]
            .as_array_mut()
            .expect("point_values is not an array");

        for pv in point_values {
            let sets = pv["sets"].as_array_mut().expect("sets is not an array");

            for set in sets {
                let questions = set["questions"]
                    .as_array_mut()
                    .expect("questions is not an array");

                for question in questions {
                    repars_question(question);
                }
            }
        }
    }

    let out = serde_json::to_string_pretty(&root).expect("Failed to serialize JSON");
    std::fs::write(JSON_PATH, out).expect("Failed to write test1_parsed.json");

    println!("Done. Reparsed variables and numeric_answers written to {JSON_PATH}");
}

fn repars_question(q: &mut Value) {
    // --- 1. Re-extract variables from question text ------------------
    let text = q["text"].as_str().unwrap_or("");
    let extracted = extract_variables(text);

    let new_vars: Vec<Value> = extracted
        .iter()
        .map(|ev| {
            serde_json::json!({
                "value": ev.value,
                "unit": ev.unit,
            })
        })
        .collect();

    q["variables"] = Value::Array(new_vars);

    // --- 2. Recompute numeric_answer from answer_text ----------------
    let answer_text = q["answer_text"].as_str().unwrap_or("");
    let ans_vars = extract_variables(answer_text);

    if let Some(first) = ans_vars.first() {
        q["numeric_answer"] = serde_json::json!(first.value);
    }
    // If answer_text has no parseable number, keep the existing numeric_answer.
}
