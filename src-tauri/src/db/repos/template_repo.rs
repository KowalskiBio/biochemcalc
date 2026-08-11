use crate::db::DbError;
use crate::models::{
    ConstraintType, ResultConstraint, Template, TemplateConstant, TemplateVariable,
};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct TemplateRepo;

impl TemplateRepo {
    /// Insert a template along with its linked variables, constants, and constraint.
    pub fn insert(
        conn: &Connection,
        template: &Template,
        variables: &[TemplateVariable],
        constants: &[TemplateConstant],
        constraint: Option<&ResultConstraint>,
    ) -> Result<(), DbError> {
        let tx = conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO templates (id, question_text, formula, equation_text, numeric_answer, result_unit, point_value, significant_digits, topic_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                template.id,
                template.question_text,
                template.formula,
                template.equation_text,
                template.numeric_answer,
                template.result_unit,
                template.point_value,
                template.significant_digits,
                Uuid::nil(),
                template.created_at.to_rfc3339(),
            ],
        )?;

        for tv in variables {
            tx.execute(
                "INSERT INTO template_variables (template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    tv.template_id,
                    tv.variable_id,
                    tv.placeholder,
                    tv.greater_than_variable_id,
                    tv.less_than_variable_id,
                ],
            )?;
        }

        for tc in constants {
            tx.execute(
                "INSERT INTO template_constants (template_id, constant_id) VALUES (?1, ?2)",
                params![tc.template_id, tc.constant_id],
            )?;
        }

        if let Some(rc) = constraint {
            tx.execute(
                "INSERT INTO result_constraints (id, template_id, min_result, max_result, sd_allowed, constraint_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    rc.id,
                    rc.template_id,
                    rc.min_result,
                    rc.max_result,
                    rc.sd_allowed,
                    serde_constraint_type(rc.constraint_type),
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn list_all(conn: &Connection) -> Result<Vec<Template>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, question_text, formula, equation_text, numeric_answer, result_unit, point_value, significant_digits, created_at
             FROM templates ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Template {
                id: row.get(0)?,
                question_text: row.get(1)?,
                formula: row.get(2)?,
                equation_text: row.get(3)?,
                numeric_answer: row.get(4)?,
                result_unit: row.get(5)?,
                point_value: row.get(6)?,
                significant_digits: row.get(7)?,
                created_at: parse_dt(row.get::<_, String>(8)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn find_by_question_and_equation(
        conn: &Connection,
        question_text: &str,
        equation_text: &str,
    ) -> Result<Option<Template>, DbError> {
        let result = conn.query_row(
            "SELECT id, question_text, formula, equation_text, numeric_answer, result_unit, point_value, significant_digits, created_at
             FROM templates
             WHERE question_text = ?1 AND equation_text = ?2
             LIMIT 1",
            params![question_text, equation_text],
            |row| {
                Ok(Template {
                    id: row.get(0)?,
                    question_text: row.get(1)?,
                    formula: row.get(2)?,
                    equation_text: row.get(3)?,
                    numeric_answer: row.get(4)?,
                    result_unit: row.get(5)?,
                    point_value: row.get(6)?,
                    significant_digits: row.get(7)?,
                    created_at: parse_dt(row.get::<_, String>(8)?),
                })
            },
        );
        match result {
            Ok(template) => Ok(Some(template)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    pub fn get_by_id(conn: &Connection, id: &Uuid) -> Result<Template, DbError> {
        conn.query_row(
            "SELECT id, question_text, formula, equation_text, numeric_answer, result_unit, point_value, significant_digits, created_at
             FROM templates WHERE id = ?1",
            params![id],
            |row| {
                Ok(Template {
                    id: row.get(0)?,
                    question_text: row.get(1)?,
                    formula: row.get(2)?,
                    equation_text: row.get(3)?,
                    numeric_answer: row.get(4)?,
                    result_unit: row.get(5)?,
                    point_value: row.get(6)?,
                    significant_digits: row.get(7)?,
                    created_at: parse_dt(row.get::<_, String>(8)?),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Template {id}")),
            other => DbError::Sqlite(other),
        })
    }

    /// Fetch variables linked to a template.
    pub fn get_variables(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Vec<TemplateVariable>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT template_id, variable_id, placeholder, greater_than_variable_id, less_than_variable_id
             FROM template_variables WHERE template_id = ?1",
        )?;
        let rows = stmt.query_map(params![template_id], |row| {
            Ok(TemplateVariable {
                template_id: row.get(0)?,
                variable_id: row.get(1)?,
                placeholder: row.get(2)?,
                greater_than_variable_id: row.get(3)?,
                less_than_variable_id: row.get(4)?,
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn get_variables_with_comparisons(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Vec<crate::models::Variable>, DbError> {
        use crate::db::repos::VariableRepo;
        let links = Self::get_variables(conn, template_id)?;
        let mut variables = Vec::with_capacity(links.len());
        for tv in &links {
            let mut variable = VariableRepo::get_by_id(conn, &tv.variable_id)?;
            if let Some(greater_id) = tv.greater_than_variable_id {
                let target = VariableRepo::get_by_id(conn, &greater_id)?;
                variable.greater_than = Some(target.symbol);
            }
            if let Some(less_id) = tv.less_than_variable_id {
                let target = VariableRepo::get_by_id(conn, &less_id)?;
                variable.less_than = Some(target.symbol);
            }
            variables.push(variable);
        }
        Ok(variables)
    }

    /// Fetch constants linked to a template.
    pub fn get_constants(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Vec<TemplateConstant>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT template_id, constant_id FROM template_constants WHERE template_id = ?1",
        )?;
        let rows = stmt.query_map(params![template_id], |row| {
            Ok(TemplateConstant {
                template_id: row.get(0)?,
                constant_id: row.get(1)?,
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    /// Fetch the result constraint for a template, if any.
    pub fn get_constraint(
        conn: &Connection,
        template_id: &Uuid,
    ) -> Result<Option<ResultConstraint>, DbError> {
        let result = conn.query_row(
            "SELECT id, template_id, min_result, max_result, sd_allowed, constraint_type
             FROM result_constraints WHERE template_id = ?1",
            params![template_id],
            |row| {
                Ok(ResultConstraint {
                    id: row.get(0)?,
                    template_id: row.get(1)?,
                    min_result: row.get(2)?,
                    max_result: row.get(3)?,
                    sd_allowed: row.get(4)?,
                    constraint_type: parse_constraint_type(&row.get::<_, String>(5)?),
                })
            },
        );
        match result {
            Ok(rc) => Ok(Some(rc)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    #[cfg(test)]
    pub fn update(conn: &Connection, template: &Template) -> Result<(), DbError> {
        let affected = conn.execute(
            "UPDATE templates SET question_text=?2, formula=?3, equation_text=?4, numeric_answer=?5, result_unit=?6, \
             point_value=?7, significant_digits=?8, created_at=?9 WHERE id=?1",
            params![
                template.id,
                template.question_text,
                template.formula,
                template.equation_text,
                template.numeric_answer,
                template.result_unit,
                template.point_value,
                template.significant_digits,
                template.created_at.to_rfc3339(),
            ],
        )?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Template {}", template.id)));
        }
        Ok(())
    }

    pub fn find_by_equation_text(
        conn: &Connection,
        equation_text: &str,
    ) -> Result<Vec<Template>, DbError> {
        let mut stmt = conn.prepare(
            "SELECT id, question_text, formula, equation_text, numeric_answer, result_unit, point_value, significant_digits, created_at
             FROM templates WHERE equation_text = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![equation_text], |row| {
            Ok(Template {
                id: row.get(0)?,
                question_text: row.get(1)?,
                formula: row.get(2)?,
                equation_text: row.get(3)?,
                numeric_answer: row.get(4)?,
                result_unit: row.get(5)?,
                point_value: row.get(6)?,
                significant_digits: row.get(7)?,
                created_at: parse_dt(row.get::<_, String>(8)?),
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn update_by_equation_text(
        conn: &Connection,
        old_equation_text: &str,
        new_formula: &str,
        new_equation_text: &str,
        new_result_unit: &str,
    ) -> Result<Vec<Uuid>, DbError> {
        let affected_ids: Vec<Uuid> = conn
            .prepare("SELECT id FROM templates WHERE equation_text = ?1")?
            .query_map(params![old_equation_text], |row| row.get::<_, Uuid>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        conn.execute(
            "UPDATE templates SET formula=?1, equation_text=?2, result_unit=?3 WHERE equation_text=?4",
            params![new_formula, new_equation_text, new_result_unit, old_equation_text],
        )?;

        Ok(affected_ids)
    }

    pub fn delete(conn: &Connection, id: &Uuid) -> Result<(), DbError> {
        let affected = conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(DbError::NotFound(format!("Template {id}")));
        }
        Ok(())
    }
}

fn serde_constraint_type(ct: ConstraintType) -> &'static str {
    match ct {
        ConstraintType::Range => "range",
        ConstraintType::Sd => "sd",
        ConstraintType::Both => "both",
    }
}

fn parse_constraint_type(s: &str) -> ConstraintType {
    match s {
        "sd" => ConstraintType::Sd,
        "both" => ConstraintType::Both,
        _ => ConstraintType::Range,
    }
}

fn parse_dt(s: String) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .unwrap_or_else(|_| {
            chrono::DateTime::parse_from_rfc3339("1970-01-01T00:00:00Z")
                .expect("hardcoded fallback")
        })
        .with_timezone(&chrono::Utc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Constant, ConstraintType, ResultConstraint, Variable};
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_variable(conn: &Connection, symbol: &str) -> Variable {
        let v = Variable::new(
            format!("Var {symbol}"),
            symbol.into(),
            0.0,
            100.0,
            1.0,
            "g".into(),
            1,
        );
        crate::db::repos::VariableRepo::insert(conn, &v).expect("insert var");
        v
    }

    fn insert_constant(conn: &Connection, symbol: &str) -> Constant {
        let c = Constant::new(
            format!("Const {symbol}"),
            symbol.into(),
            1.0,
            "".into(),
            false,
        );
        crate::db::repos::ConstantRepo::insert(conn, &c).expect("insert const");
        c
    }

    #[test]
    fn insert_and_retrieve_template_with_variables_and_constraint() {
        let conn = setup_conn();
        let v1 = insert_variable(&conn, "X");
        let v2 = insert_variable(&conn, "Y");
        let c1 = insert_constant(&conn, "K");

        let t = Template::new(
            "Kolik je [[X]] + [[Y]]?".into(),
            "X + Y".into(),
            "".into(),
            None,
            "g".into(),
            2,
        );

        let tvs = vec![
            TemplateVariable {
                template_id: t.id,
                variable_id: v1.id,
                placeholder: "X".into(),
                greater_than_variable_id: None,
                less_than_variable_id: None,
            },
            TemplateVariable {
                template_id: t.id,
                variable_id: v2.id,
                placeholder: "Y".into(),
                greater_than_variable_id: None,
                less_than_variable_id: None,
            },
        ];
        let tcs = vec![TemplateConstant {
            template_id: t.id,
            constant_id: c1.id,
        }];
        let rc = ResultConstraint::new(t.id, Some(0.0), Some(200.0), None, ConstraintType::Range);

        TemplateRepo::insert(&conn, &t, &tvs, &tcs, Some(&rc)).expect("insert");

        let fetched = TemplateRepo::get_by_id(&conn, &t.id).expect("get");
        assert_eq!(fetched.point_value, 2);

        let linked_vars = TemplateRepo::get_variables(&conn, &t.id).expect("vars");
        assert_eq!(linked_vars.len(), 2);

        let linked_consts = TemplateRepo::get_constants(&conn, &t.id).expect("consts");
        assert_eq!(linked_consts.len(), 1);

        let constraint = TemplateRepo::get_constraint(&conn, &t.id).expect("constraint");
        assert!(constraint.is_some());
    }

    #[test]
    fn update_modifies_template_fields() {
        let conn = setup_conn();
        let t = Template::new("Q?".into(), "X".into(), "".into(), None, "g".into(), 3);
        TemplateRepo::insert(&conn, &t, &[], &[], None).expect("insert");

        let mut updated = t.clone();
        updated.question_text = "Better Q?".into();
        TemplateRepo::update(&conn, &updated).expect("update");

        let fetched = TemplateRepo::get_by_id(&conn, &t.id).expect("get");
        assert_eq!(fetched.question_text, "Better Q?");
    }

    #[test]
    fn delete_removes_template() {
        let conn = setup_conn();
        let t = Template::new("Q?".into(), "X".into(), "".into(), None, "g".into(), 2);
        TemplateRepo::insert(&conn, &t, &[], &[], None).expect("insert");
        TemplateRepo::delete(&conn, &t.id).expect("delete");
        let result = TemplateRepo::get_by_id(&conn, &t.id);
        assert!(result.is_err());
    }

    #[test]
    fn constraint_is_none_when_not_set() {
        let conn = setup_conn();
        let t = Template::new("Q?".into(), "X".into(), "".into(), None, "g".into(), 2);
        TemplateRepo::insert(&conn, &t, &[], &[], None).expect("insert");
        let rc = TemplateRepo::get_constraint(&conn, &t.id).expect("constraint");
        assert!(rc.is_none());
    }
}
