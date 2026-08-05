use crate::models::{Template, TemplateMode, Variant};
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Format a floating point number using Czech decimal comma.
fn fmt_cz(value: f64, precision: u8) -> String {
    if precision == 0 {
        return format!("{:.0}", value).replace('.', ",");
    }
    let width = precision as usize;
    let s = format!("{:.width$}", value);
    s.replace('.', ",")
}

/// Apply the same chemical formatting used in the UI renderer:
/// H2O -> H<sub>2</sub>O, X^2 -> X<sup>2</sup>, a*b -> a×b.
/// Existing HTML tags (including <sup>, <sub>, &nbsp;) are preserved.
fn format_chemical_text(text: &str) -> String {
    static HYDRATE_RE: OnceLock<Regex> = OnceLock::new();
    static SUP_RE: OnceLock<Regex> = OnceLock::new();
    static SUB_RE: OnceLock<Regex> = OnceLock::new();
    static DOT_MUL_RE: OnceLock<Regex> = OnceLock::new();
    static STAR_MUL_RE: OnceLock<Regex> = OnceLock::new();

    let hydrate_re = HYDRATE_RE
        .get_or_init(|| Regex::new(r"([A-Za-z0-9)])[\*·.](\d*)(H[₂2_]?[_₂2]?O)\b").unwrap());
    let sup_re = SUP_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)(])\^([+-]?\d+[+-]?)").unwrap());
    let sub_re = SUB_RE.get_or_init(|| Regex::new(r"([A-Z][a-z]?|\))_(\d+)").unwrap());
    let dot_mul_re = DOT_MUL_RE.get_or_init(|| Regex::new(r"([A-Za-z)])\.([A-Za-z0-9(])").unwrap());
    let star_mul_re =
        STAR_MUL_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)])[\*·]([A-Za-z0-9(])").unwrap());

    let text = hydrate_re.replace_all(text, "$1×$2$3");
    let text = sup_re.replace_all(&text, "$1<sup>$2</sup>");
    let text = sub_re.replace_all(&text, "$1<sub>$2</sub>");
    let text = dot_mul_re.replace_all(&text, "$1×$2");
    star_mul_re.replace_all(&text, "$1×$2").into_owned()
}

/// Apply chemical formatting so the exported static text matches the UI renderer.
fn format_text_segment(text: &str) -> String {
    static DOT_HYDRATE_RE: OnceLock<Regex> = OnceLock::new();
    static DOT_MUL_RE: OnceLock<Regex> = OnceLock::new();

    let dot_hydrate_re = DOT_HYDRATE_RE
        .get_or_init(|| Regex::new(r"([A-Za-z0-9)])\.(\d*)(H[₂2_]?[_₂2]?O)\b").unwrap());
    let dot_mul_re = DOT_MUL_RE.get_or_init(|| Regex::new(r"([A-Za-z)])\.([A-Za-z0-9(])").unwrap());

    let text = dot_hydrate_re.replace_all(text, "$1×$2$3");
    let text = dot_mul_re.replace_all(&text, "$1×$2");
    format_chemical_text(&text)
}

fn render_question(
    text: &str,
    assigned: &HashMap<String, f64>,
    assigned_strings: &HashMap<String, String>,
    precisions: &HashMap<String, u8>,
) -> String {
    static PLACEHOLDER_RE: OnceLock<Regex> = OnceLock::new();
    let re = PLACEHOLDER_RE.get_or_init(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());

    let mut rendered = String::new();
    let mut last_end = 0;

    for cap in re.captures_iter(text) {
        let full = cap.get(0).expect("placeholder regex always matches full");
        rendered.push_str(&format_text_segment(&text[last_end..full.start()]));

        let symbol = cap
            .get(1)
            .expect("placeholder regex always has group 1")
            .as_str();
        if let Some(value) = assigned.get(symbol) {
            let precision = precisions.get(symbol).copied().unwrap_or(1);
            rendered.push_str(&fmt_cz(*value, precision));
        } else if let Some(value) = assigned_strings.get(symbol) {
            rendered.push_str(&format_chemical_text(value));
        } else {
            rendered.push_str(full.as_str());
        }

        last_end = full.end();
    }
    rendered.push_str(&format_text_segment(&text[last_end..]));
    rendered
}

fn render_multi_closed_options(
    out: &mut String,
    answers: &[crate::models::AnswerField],
    precision: u8,
    point_value: u8,
) {
    let option_count = answers[0]
        .numeric_options
        .as_ref()
        .expect("closed answer field has numeric options")
        .len();
    let correct_option = answers[0].correct_option.unwrap_or(1);

    for idx in 0..option_count {
        let label = idx + 1;
        let parts: Vec<String> = answers
            .iter()
            .map(|a| {
                let value = a.numeric_options.as_ref().unwrap()[idx];
                let unit = a.unit.as_deref().unwrap_or("");
                if unit.is_empty() {
                    fmt_cz(value, precision)
                } else {
                    format!("{} {}", fmt_cz(value, precision), unit)
                }
            })
            .collect();
        out.push_str(&format!(" :r{} {}\n", label, parts.join(", ")));
    }
    out.push_str(&format!(":r{} ok {}\n", correct_option, point_value));
}

fn render_multi_open_intervals(
    out: &mut String,
    answers: &[crate::models::AnswerField],
    point_value: u8,
) {
    let parts: Vec<String> = answers
        .iter()
        .map(|a| {
            let lo = a.interval_lo.expect("open answer field has lower bound");
            let hi = a.interval_hi.expect("open answer field has upper bound");
            let unit = a.unit.as_deref().unwrap_or("");
            if unit.is_empty() {
                format!("\"{}..{}\"", fmt_cz(lo, 1), fmt_cz(hi, 1))
            } else {
                format!("\"{}..{}\" {}", fmt_cz(lo, 1), fmt_cz(hi, 1), unit)
            }
        })
        .collect();
    out.push_str(" :n\n");
    out.push_str(&format!(":n={} {} ok\n", parts.join(", "), point_value));
}

/// A lightweight input for the export writer.
pub struct ExportQuestion<'a> {
    pub template: &'a Template,
    pub variant: &'a Variant,
    pub variable_precisions: HashMap<String, u8>,
    pub result_precision: u8,
    pub mode: TemplateMode,
}

/// Write a full `.txt` output from a sequence of questions.
pub fn write_txt(questions: &[ExportQuestion<'_>]) -> String {
    let mut out = String::new();

    for (i, q) in questions.iter().enumerate() {
        if i > 0 {
            out.push_str("--\n\n");
        }

        let rendered = render_question(
            &q.template.question_text,
            &q.variant.assigned_values,
            &q.variant.assigned_strings,
            &q.variable_precisions,
        );
        out.push_str(&format!("{} ({} b)\n\n", rendered, q.template.point_value));

        match q.mode {
            TemplateMode::Closed => {
                if let Some(answers) = &q.variant.answers_data {
                    render_multi_closed_options(
                        &mut out,
                        answers,
                        q.result_precision,
                        q.template.point_value,
                    );
                } else {
                    let numeric = q
                        .variant
                        .numeric_options
                        .as_ref()
                        .expect("closed variant has numeric options");
                    for (idx, value) in numeric.iter().enumerate() {
                        let label = idx + 1;
                        out.push_str(&format!(
                            " :r{} {} {}\n",
                            label,
                            fmt_cz(*value, q.result_precision),
                            q.template.result_unit
                        ));
                    }
                    let correct = q
                        .variant
                        .correct_option
                        .expect("closed variant has correct option");
                    out.push_str(&format!(":r{} ok {}\n", correct, q.template.point_value));
                }
            }
            TemplateMode::Open => {
                if let Some(answers) = &q.variant.answers_data {
                    render_multi_open_intervals(&mut out, answers, q.template.point_value);
                } else {
                    let lo = q
                        .variant
                        .interval_lo
                        .expect("open variant has interval lower bound");
                    let hi = q
                        .variant
                        .interval_hi
                        .expect("open variant has interval upper bound");
                    out.push_str(" :n\n");
                    out.push_str(&format!(
                        ":n=\"{}..{}\" {} ok\n",
                        fmt_cz(lo, 1),
                        fmt_cz(hi, 1),
                        q.template.point_value
                    ));
                }
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;
    use uuid::Uuid;

    fn make_template(text: &str) -> Template {
        Template {
            id: Uuid::new_v4(),
            question_text: text.to_string(),
            formula: "X * 2".to_string(),
            equation_text: String::new(),
            numeric_answer: None,
            result_unit: "g".to_string(),
            point_value: 3,
            created_at: Utc::now(),
        }
    }

    fn make_closed_variant() -> Variant {
        Variant::new(
            Uuid::new_v4(),
            [("X".to_string(), 32.0)].into(),
            HashMap::new(),
            64.0,
            Some(vec![64.0, 70.0, 58.0, 80.0, 60.0]),
            Some(1),
            None,
            None,
            1,
        )
    }

    #[test]
    fn closed_format() {
        let template = make_template("Kolik gramů vody bude třeba, aby z [[X]] g KBr...");
        let variant = make_closed_variant();
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("32,0 g KBr"));
        assert!(output.contains(" :r1 64,0 g"));
        assert!(output.contains(":r1 ok 3"));
        assert!(!output.contains("Žádná možnost"));
    }

    #[test]
    fn open_format() {
        let template = make_template("Vypočítejte hodnotu X.");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(45.1),
            interval_hi: Some(45.9),
            ..make_closed_variant()
        };
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains(" :n\n"));
        assert!(output.contains(":n=\"45,1..45,9\" 3 ok"));
    }

    #[test]
    fn chemical_formatting_in_export() {
        let template = make_template("Vypočítejte hmotnost H_2SO_4 a x^2 pro [[X]] ml.");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(45.1),
            interval_hi: Some(45.9),
            ..make_closed_variant()
        };
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains("H<sub>2</sub>SO<sub>4</sub>"));
        assert!(output.contains("x<sup>2</sup>"));
        assert!(output.contains("32,0 ml"));
    }

    #[test]
    fn chemical_formatting_for_string_variable_values() {
        let template = make_template("Vypočítejte hustotu [[plyn]]. [rho]");
        let mut variant = make_closed_variant();
        variant
            .assigned_strings
            .insert("plyn".to_string(), "N_2".to_string());
        let precisions = HashMap::new();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("N<sub>2</sub>"));
        assert!(!output.contains("N_2"));
    }

    #[test]
    fn preserves_existing_html_tags() {
        let template = make_template("Koncentrace <sup>+</sup>&nbsp;je [[X]] mol/l.");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(45.1),
            interval_hi: Some(45.9),
            ..make_closed_variant()
        };
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains("<sup>+</sup>"));
        assert!(output.contains("&nbsp;"));
        assert!(output.contains("32,0 mol/l"));
    }

    #[test]
    fn multi_answer_closed_format() {
        let template = make_template("Vypočítejte [n mol][m g]");
        let mut variant = make_closed_variant();
        variant.answers_data = Some(vec![
            crate::models::AnswerField {
                symbol: "n".to_string(),
                value: 2.0,
                unit: Some("mol".to_string()),
                numeric_options: Some(vec![2.0, 1.5, 2.5, 3.0, 1.0]),
                correct_option: Some(1),
                interval_lo: None,
                interval_hi: None,
            },
            crate::models::AnswerField {
                symbol: "m".to_string(),
                value: 4.0,
                unit: Some("g".to_string()),
                numeric_options: Some(vec![4.0, 3.2, 4.8, 5.0, 3.5]),
                correct_option: Some(1),
                interval_lo: None,
                interval_hi: None,
            },
        ]);
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains(" :r1 2,0 mol, 4,0 g"));
        assert!(output.contains(":r1 ok 3"));
    }

    #[test]
    fn multi_answer_open_format() {
        let template = make_template("Vypočítejte [n mol][m g]");
        let mut variant = make_closed_variant();
        variant.answers_data = Some(vec![
            crate::models::AnswerField {
                symbol: "n".to_string(),
                value: 2.0,
                unit: Some("mol".to_string()),
                numeric_options: None,
                correct_option: None,
                interval_lo: Some(1.8),
                interval_hi: Some(2.2),
            },
            crate::models::AnswerField {
                symbol: "m".to_string(),
                value: 4.0,
                unit: Some("g".to_string()),
                numeric_options: None,
                correct_option: None,
                interval_lo: Some(3.8),
                interval_hi: Some(4.2),
            },
        ]);
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains(":n=\"1,8..2,2\" mol, \"3,8..4,2\" g 3 ok"));
    }

    #[test]
    fn hydrate_dot_in_export() {
        let template = make_template("Vypočítejte hmotnost FeSO4.7H2O.");
        let variant = make_closed_variant();
        let precisions = HashMap::new();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("FeSO4×7H2O"));
        assert!(!output.contains("FeSO4.7H2O"));
    }

    #[test]
    fn hydrate_star_in_export() {
        let template = make_template("Vypočítejte hmotnost FeSO4*7H_2O.");
        let variant = make_closed_variant();
        let precisions = HashMap::new();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("FeSO4×7H<sub>2</sub>O"));
        assert!(!output.contains("FeSO4*7H_2O"));
    }

    #[test]
    fn unit_multiplication_in_export() {
        let template = make_template("Hustota je 1.5 g*cm^-3.");
        let variant = make_closed_variant();
        let precisions = HashMap::new();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("g×cm<sup>-3</sup>"));
        assert!(output.contains("1.5"));
    }

    #[test]
    fn unit_dot_in_export() {
        let template = make_template("Hustota je 1.5 g.cm^-3.");
        let variant = make_closed_variant();
        let precisions = HashMap::new();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            result_precision: 1,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("g×cm<sup>-3</sup>"));
        assert!(output.contains("1.5"));
    }
}
