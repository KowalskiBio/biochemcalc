use crate::models::{Notation, Template, TemplateMode, Variant};
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

/// Mantissa precision for scientific notation, e.g. `5,21×10<sup>24</sup>`.
const SCIENTIFIC_MANTISSA_DECIMALS: u8 = 2;

/// Above this magnitude a plain decimal stops being readable — a molecule
/// count would otherwise print as 26 digits, most of them floating-point
/// noise. Mirrors `SCIENTIFIC_UPPER_THRESHOLD` in `src/lib/math-utils.ts` so
/// the exported test and the on-screen preview agree.
const SCIENTIFIC_UPPER_THRESHOLD: f64 = 1e6;

/// Below this magnitude a fixed-point string has more than one leading zero
/// after the decimal point — `0,1` is acceptable, `0,01` is not. Mirrors
/// `SCIENTIFIC_LOWER_THRESHOLD` in `src/lib/math-utils.ts`; without this,
/// atomic-mass-scale answers (~1e-22) print as a wall of decimal zeros
/// instead of scientific notation, even though the on-screen preview
/// already switches to scientific for the same value via that JS constant.
const SCIENTIFIC_LOWER_THRESHOLD: f64 = 0.1;

/// Czech-formatted scientific notation with an HTML superscript exponent, the
/// same shape the UI renders and the same markup the exported question text
/// already uses for formulae (`H<sub>2</sub>O`, `cm<sup>-3</sup>`).
///
/// `mantissa_decimals` mirrors the UI: `SCIENTIFIC_MANTISSA_DECIMALS` (2) by
/// default, but `sigDigits - 1` when significant digits are configured, so
/// e.g. 4 significant digits shows a 3-decimal mantissa here exactly as it
/// does in `formatSignificantDigits` in `src/lib/math-utils.ts`.
fn fmt_scientific_cz(value: f64, mantissa_decimals: u8) -> String {
    if value == 0.0 || !value.is_finite() {
        return fmt_cz(value, mantissa_decimals);
    }

    let mut exponent = value.abs().log10().floor() as i32;
    // Rounding the mantissa can carry it up to 10,00 (e.g. 9,999×10^5), which
    // belongs in the next decade instead.
    let mantissa_rounded: f64 = fmt_cz(value / 10f64.powi(exponent), mantissa_decimals)
        .replace(',', ".")
        .parse()
        .unwrap_or(0.0);
    if mantissa_rounded.abs() >= 10.0 {
        exponent += 1;
    }

    let mantissa = value / 10f64.powi(exponent);
    format!(
        "{}×10<sup>{}</sup>",
        fmt_cz(mantissa, mantissa_decimals),
        exponent
    )
}

/// A number as a student should see it in the exported test: plain Czech
/// decimal when that reads naturally, scientific notation when it does not.
///
/// Deliberately has no lower-magnitude threshold — unlike `fmt_option_value`,
/// this is shared with open-answer interval bounds, which already have their
/// own joint "both bounds must stay distinguishable" logic in
/// `interval_precision` and intentionally keep small-but-ordinary values
/// (e.g. `0,08..0,15`) as plain decimals rather than switching only the
/// smaller bound to scientific notation.
fn fmt_value_cz(value: f64, precision: u8) -> String {
    let plain = fmt_cz(value, precision);
    let rounded: f64 = plain.replace(',', ".").parse().unwrap_or(value);
    // Too small to survive rounding, or too large to write out in full.
    if (rounded == 0.0 && value != 0.0) || rounded.abs() >= SCIENTIFIC_UPPER_THRESHOLD {
        return fmt_scientific_cz(value, SCIENTIFIC_MANTISSA_DECIMALS);
    }
    plain
}

/// Apply the same chemical formatting used in the UI renderer:
/// H2O -> H<sub>2</sub>O, X^2 -> X<sup>2</sup>, a*b -> a.b.
/// Existing HTML tags (including <sup>, <sub>, &nbsp;) are preserved.
fn format_chemical_text(text: &str) -> String {
    static HYDRATE_RE: OnceLock<Regex> = OnceLock::new();
    static SUP_RE: OnceLock<Regex> = OnceLock::new();
    static SUB_RE: OnceLock<Regex> = OnceLock::new();
    static STAR_MUL_RE: OnceLock<Regex> = OnceLock::new();

    let hydrate_re = HYDRATE_RE
        .get_or_init(|| Regex::new(r"([A-Za-z0-9)])[\*·.](\d*)(H[₂2_]?[_₂2]?O)\b").unwrap());
    let sup_re = SUP_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)(])\^([+-]?\d+[+-]?|[+-])").unwrap());
    // Chained compound subscripts (K_a_1 -> Ka1, one symbol, one subscript)
    // merge into a single <sub>; each "_xxx" segment stays non-greedy so
    // H_2SO_4 splits into two subscripts instead of swallowing "SO".
    let sub_re =
        SUB_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)])((?:_[A-Za-z0-9]+?)+)").unwrap());
    let star_mul_re =
        STAR_MUL_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)])[\*·]([A-Za-z0-9(])").unwrap());

    let text = hydrate_re.replace_all(text, "$1.$2$3");
    let text = sup_re.replace_all(&text, "$1<sup>$2</sup>");
    let text = sub_re.replace_all(&text, |caps: &regex::Captures| {
        format!("{}<sub>{}</sub>", &caps[1], caps[2].replace('_', ""))
    });
    star_mul_re.replace_all(&text, "$1.$2").into_owned()
}

/// Apply chemical formatting so the exported static text matches the UI renderer.
fn format_text_segment(text: &str) -> String {
    format_chemical_text(text)
}

/// Format a value using significant figures, with Czech decimal comma.
fn fmt_significant_cz(value: f64, sig_digits: u8) -> String {
    if value == 0.0 || !value.is_finite() {
        let zeros = if sig_digits > 1 { sig_digits - 1 } else { 0 };
        return format!("0,{}", "0".repeat(zeros as usize));
    }
    let abs = value.abs();
    let order = abs.log10().floor() as i32;
    let decimals = sig_digits as i32 - 1 - order;
    if decimals < 0 {
        let factor = 10f64.powi(-decimals);
        let rounded = (value / factor).round() * factor;
        return fmt_cz(rounded, 0);
    }
    fmt_cz(value, decimals as u8)
}

/// Format a variable value for export: significant digits when set, otherwise
/// fixed precision.
fn fmt_variable_value(
    value: f64,
    precision: u8,
    sig_digits: Option<u8>,
    notation: Notation,
) -> String {
    // Mirrors formatSignificantDigits/formatNumberMaxDecimals in
    // src/lib/math-utils.ts: the mantissa gets as many decimals as the
    // configured significant digits allow (sigDigits - 1), or the fixed
    // default when no significant digits are set.
    let mantissa_decimals = sig_digits
        .map(|n| n.saturating_sub(1))
        .unwrap_or(SCIENTIFIC_MANTISSA_DECIMALS);
    let want_scientific = notation == Notation::Scientific;
    let want_normal = notation == Notation::Normal;
    if want_scientific && value != 0.0 && value.is_finite() {
        return fmt_scientific_cz(value, mantissa_decimals);
    }
    match sig_digits {
        Some(n) => {
            let formatted = fmt_significant_cz(value, n);
            let rounded: f64 = formatted.replace(',', ".").parse().unwrap_or(value);
            // "normal" suppresses the threshold triggers but keeps the
            // zero-collapse fallback so a tiny value doesn't read "0".
            if (want_scientific || (!want_normal && ((rounded == 0.0 && value != 0.0) || rounded.abs() >= SCIENTIFIC_UPPER_THRESHOLD)))
                && value != 0.0
                && value.is_finite()
            {
                return fmt_scientific_cz(value, mantissa_decimals);
            }
            formatted
        }
        None => {
            if want_normal {
                return fmt_value_cz(value, precision);
            }
            let formatted = fmt_value_cz(value, precision);
            let rounded: f64 = formatted.replace(',', ".").parse().unwrap_or(value);
            if (rounded == 0.0 && value != 0.0) || rounded.abs() >= SCIENTIFIC_UPPER_THRESHOLD {
                return fmt_scientific_cz(value, mantissa_decimals);
            }
            formatted
        }
    }
}

/// Format one multiple-choice option: same as `fmt_variable_value`, but also
/// switches to scientific notation for small-but-nonzero values below
/// `SCIENTIFIC_LOWER_THRESHOLD` that wouldn't otherwise round to exactly
/// zero. An atomic mass (~1e-22) formatted with, say, 4 significant digits
/// never rounds to "0" at any precision `fmt_variable_value` would try, so
/// its existing zero-collapse fallback never fires and it would otherwise
/// print as a wall of decimal zeros. Scoped to options only — not reused for
/// open-answer interval bounds, which already have their own joint "both
/// bounds must stay distinguishable" precision logic and intentionally keep
/// small-but-ordinary values (e.g. `0,08..0,15`) as plain decimals.
fn fmt_option_value(value: f64, precision: u8, sig_digits: Option<u8>, notation: Notation) -> String {
    if notation != Notation::Scientific && value != 0.0 && value.is_finite() && value.abs() < SCIENTIFIC_LOWER_THRESHOLD {
        let mantissa_decimals = sig_digits
            .map(|n| n.saturating_sub(1))
            .unwrap_or(SCIENTIFIC_MANTISSA_DECIMALS);
        return fmt_scientific_cz(value, mantissa_decimals);
    }
    fmt_variable_value(value, precision, sig_digits, notation)
}

fn render_question(
    text: &str,
    assigned: &HashMap<String, f64>,
    assigned_strings: &HashMap<String, String>,
    precisions: &HashMap<String, u8>,
    significant_digits: &HashMap<String, u8>,
    notations: &HashMap<String, Notation>,
) -> String {
    // The trailing `[n]` / `[n mol]` markers tell the generator which symbol
    // to solve for — they are not part of the question and must never reach
    // the exported test a student sits.
    let text = crate::engine::answer_targets::strip_answer_targets(text);

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
        // Handle "Ka=wac" (linked) and "Ka=1.8e-5" (fixed) placeholder forms.
        // The left side of "=" is the symbol to look up in numeric assignments.
        let (lookup_key, has_eq) = match symbol.find('=') {
            Some(pos) => (&symbol[..pos], true),
            None => (symbol, false),
        };
        if let Some(&value) = assigned.get(lookup_key) {
            let precision = precisions.get(lookup_key).copied().unwrap_or(1);
            let sig_digits = significant_digits.get(lookup_key).copied();
            let notation = notations.get(lookup_key).copied().unwrap_or(Notation::Auto);
            rendered.push_str(&fmt_variable_value(value, precision, sig_digits, notation));
        } else if !has_eq {
            if let Some(value) = assigned_strings.get(symbol) {
                rendered.push_str(&format_chemical_text(value));
            } else {
                rendered.push_str(full.as_str());
            }
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
    sig_digits: Option<u8>,
    notation: Notation,
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
                    fmt_option_value(value, precision, sig_digits, notation)
                } else {
                    format!("{} {}", fmt_option_value(value, precision, sig_digits, notation), unit)
                }
            })
            .collect();
        out.push_str(&format!(" :r{} {}\n", label, parts.join(", ")));
    }
    out.push_str(&format!(":r{} ok {}\n", correct_option, point_value));
    if let Some(alt) = answers[0].alternate_option {
        out.push_str(&format!(":r{} ok {}\n", alt, point_value));
    }
}

/// Decimals needed to keep an interval's two bounds distinguishable.
///
/// A ±30 % tolerance on an answer of 0.11 spans 0.08–0.15, but printed at one
/// decimal both ends collapse to `0,1` — an interval that accepts nothing but
/// the rounded midpoint. Widen the precision until the bounds actually differ.
fn interval_precision(lo: f64, hi: f64, preferred: u8) -> u8 {
    const MAX_PRECISION: u8 = 8;
    let mut precision = preferred;
    while precision < MAX_PRECISION && fmt_cz(lo, precision) == fmt_cz(hi, precision) {
        precision += 1;
    }
    precision
}

fn render_multi_open_intervals(
    out: &mut String,
    answers: &[crate::models::AnswerField],
    point_value: u8,
    result_precision: u8,
    result_sig_digits: Option<u8>,
    notation: Notation,
) {
    let parts: Vec<String> = answers
        .iter()
        .map(|a| {
            let lo = a.interval_lo.expect("open answer field has lower bound");
            let hi = a.interval_hi.expect("open answer field has upper bound");
            let unit = a.unit.as_deref().unwrap_or("");
            let mantissa_decimals = result_sig_digits
                .map(|n| n.saturating_sub(1))
                .unwrap_or(SCIENTIFIC_MANTISSA_DECIMALS);
            let (lo_str, hi_str) = if notation == Notation::Scientific && lo != 0.0 && hi != 0.0 {
                (
                    fmt_scientific_cz(lo, mantissa_decimals),
                    fmt_scientific_cz(hi, mantissa_decimals),
                )
            } else {
                match result_sig_digits {
                    Some(n) => (
                        fmt_variable_value(lo, 0, Some(n), Notation::Auto),
                        fmt_variable_value(hi, 0, Some(n), Notation::Auto),
                    ),
                    None => {
                        let precision = interval_precision(lo, hi, result_precision);
                        (fmt_value_cz(lo, precision), fmt_value_cz(hi, precision))
                    }
                }
            };
            if unit.is_empty() {
                format!("\"{}..{}\"", lo_str, hi_str)
            } else {
                format!("\"{}..{}\" {}", lo_str, hi_str, unit)
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
    pub variable_significant_digits: HashMap<String, u8>,
    pub variable_notations: HashMap<String, Notation>,
    pub result_precision: u8,
    pub result_significant_digits: Option<u8>,
    pub force_scientific: bool,
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
            &q.variable_significant_digits,
            &q.variable_notations,
        );
        out.push_str(&format!("{} ({} b)\n\n", rendered, q.template.point_value));

        let result_notation = if q.force_scientific {
            Notation::Scientific
        } else {
            Notation::Auto
        };

        match q.mode {
            TemplateMode::Closed => {
                if let Some(answers) = &q.variant.answers_data {
                    render_multi_closed_options(
                        &mut out,
                        answers,
                        q.result_precision,
                        q.result_significant_digits,
                        result_notation,
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
                            fmt_option_value(*value, q.result_precision, q.result_significant_digits, result_notation),
                            q.template.result_unit
                        ));
                    }
                    let correct = q
                        .variant
                        .correct_option
                        .expect("closed variant has correct option");
                    out.push_str(&format!(":r{} ok {}\n", correct, q.template.point_value));
                    if let Some(alt) = q.variant.alternate_option {
                        out.push_str(&format!(":r{} ok {}\n", alt, q.template.point_value));
                    }
                }
            }
            TemplateMode::Open => {
                if let Some(answers) = &q.variant.answers_data {
                    render_multi_open_intervals(
                        &mut out,
                        answers,
                        q.template.point_value,
                        q.result_precision,
                        q.result_significant_digits,
                        result_notation,
                    );
                } else {
                    let lo = q
                        .variant
                        .interval_lo
                        .expect("open variant has interval lower bound");
                    let hi = q
                        .variant
                        .interval_hi
                        .expect("open variant has interval upper bound");
                    let mantissa_decimals = q
                        .result_significant_digits
                        .map(|n| n.saturating_sub(1))
                        .unwrap_or(SCIENTIFIC_MANTISSA_DECIMALS);
                    let (lo_str, hi_str) = if q.force_scientific && lo != 0.0 && hi != 0.0 {
                        (
                            fmt_scientific_cz(lo, mantissa_decimals),
                            fmt_scientific_cz(hi, mantissa_decimals),
                        )
                    } else {
                        match q.result_significant_digits {
                            Some(n) => (
                                fmt_variable_value(lo, 0, Some(n), Notation::Auto),
                                fmt_variable_value(hi, 0, Some(n), Notation::Auto),
                            ),
                            None => {
                                let precision = interval_precision(lo, hi, q.result_precision);
                                (fmt_value_cz(lo, precision), fmt_value_cz(hi, precision))
                            }
                        }
                    };
                    out.push_str(" :n\n");
                    out.push_str(&format!(
                        ":n=\"{}..{}\" {} ok\n",
                        lo_str,
                        hi_str,
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
            significant_digits: None,
            force_scientific: false,
            decoy_formula: None,
            alternative_formula: None,
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("32,0 g KBr"));
        assert!(output.contains(" :r1 64,0 g"));
        assert!(output.contains(":r1 ok 3"));
        assert!(!output.contains("Žádná možnost"));
    }

    /// The trailing `[X]` answer-target marker is an instruction to the
    /// generator, not part of the question — a student sitting the exported
    /// test must never see it.
    #[test]
    fn answer_target_marker_is_not_exported() {
        let template = make_template("Vypočítejte látkové množství z [[X]] g vzorku. [X]");
        let variant = make_closed_variant();
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(
            output.contains("Vypočítejte látkové množství z 32,0 g vzorku. (3 b)"),
            "unexpected question line in:\n{output}"
        );
        assert!(
            !output.contains("[X]"),
            "answer-target marker leaked into export:\n{output}"
        );
    }

    /// Open questions must export a tolerance interval, never multiple-choice
    /// options — a set configured as closed but generated in open mode used to
    /// silently export `:r1..:r5` instead.
    #[test]
    fn open_mode_exports_interval_not_options() {
        let template = make_template("Přepočítejte objemové procento na hmotnostní procento.");
        let variant = Variant {
            interval_lo: Some(45.1),
            interval_hi: Some(45.9),
            numeric_options: None,
            correct_option: None,
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains(" :n\n"), "missing open marker in:\n{output}");
        assert!(
            output.contains(":n=\"45,1..45,9\" 3 ok"),
            "missing interval in:\n{output}"
        );
        assert!(
            !output.contains(":r"),
            "closed-style options leaked into an open export:\n{output}"
        );
    }

    #[test]
    fn large_values_export_as_html_scientific_notation() {
        assert_eq!(fmt_value_cz(1.524493429448685e25, 2), "1,52×10<sup>25</sup>");
        assert_eq!(fmt_value_cz(6.022e23, 2), "6,02×10<sup>23</sup>");
        assert_eq!(fmt_value_cz(-1.8433287150633585e25, 2), "-1,84×10<sup>25</sup>");
        assert_eq!(fmt_value_cz(5.2149e24, 2), "5,21×10<sup>24</sup>");
    }

    #[test]
    fn tiny_values_export_as_html_scientific_notation() {
        assert_eq!(fmt_value_cz(0.0000123, 2), "1,23×10<sup>-5</sup>");
    }

    /// A mantissa that rounds up to 10,00 belongs in the next decade.
    #[test]
    fn scientific_notation_carries_the_mantissa_into_the_next_decade() {
        assert_eq!(fmt_value_cz(9.999e6, 2), "1,00×10<sup>7</sup>");
    }

    /// Just under the threshold stays plain; at it, notation switches.
    #[test]
    fn scientific_notation_threshold_boundary() {
        assert_eq!(fmt_value_cz(999_900.0, 2), "999900,00");
        assert_eq!(fmt_value_cz(1_000_000.0, 2), "1,00×10<sup>6</sup>");
    }

    #[test]
    fn ordinary_magnitudes_stay_plain_czech_decimals() {
        assert_eq!(fmt_value_cz(2711.93, 2), "2711,93");
        assert_eq!(fmt_value_cz(0.22, 2), "0,22");
        assert_eq!(fmt_value_cz(0.0, 2), "0,00");
        assert_eq!(fmt_value_cz(351.6, 1), "351,6");
    }

    /// The reported defect: molecule-count options printed as 26 digits of
    /// mostly floating-point noise instead of readable scientific notation.
    #[test]
    fn closed_options_use_scientific_notation_for_molecule_counts() {
        let template = make_template("Jaký počet molekul obsahuje [[X]] dm^3 chloru?");
        let variant = Variant {
            numeric_options: Some(vec![1.524493429448685e25, 1.4181761080182541e25]),
            correct_option: Some(1),
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: [("X".to_string(), 0)].into(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(
            output.contains(" :r1 1,52×10<sup>25</sup>"),
            "expected HTML scientific notation, got:\n{output}"
        );
        assert!(
            !output.contains("15244934294486"),
            "raw digit expansion leaked into the export:\n{output}"
        );
        assert!(
            !output.to_lowercase().contains("e+"),
            "raw exponential syntax leaked into the export:\n{output}"
        );
    }

    /// The reported defect: an atomic-mass-scale option (~1e-22) formatted
    /// with significant digits never rounds to exactly zero at any
    /// precision, so the old zero-collapse-only fallback never switched it
    /// to scientific notation — it printed as ~22 leading decimal zeros
    /// instead. Also checks the mantissa gets `sigDigits - 1` decimals,
    /// matching the on-screen preview (`formatSignificantDigits` in
    /// `src/lib/math-utils.ts`).
    #[test]
    fn closed_options_use_scientific_notation_for_atomic_scale_masses() {
        let template = make_template("Vypočítejte hmotnost jednoho atomu Pb.");
        let variant = Variant {
            numeric_options: Some(vec![3.44e-22, 2.0e-22]),
            correct_option: Some(1),
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: Some(4),
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(
            output.contains(" :r1 3,440×10<sup>-22</sup>"),
            "expected 4-sig-digit HTML scientific notation, got:\n{output}"
        );
        assert!(
            !output.contains("00000000000000000000"),
            "raw decimal expansion leaked into the export:\n{output}"
        );
    }

    /// Each closed option is its own line, so — unlike interval bounds,
    /// which must stay jointly readable on one `lo..hi` line — one option
    /// crossing the lower threshold and a sibling option not crossing it is
    /// fine: each is formatted independently, matching how `FormattedResult`
    /// (`src/components/ui/formatted-result.tsx`) renders each option in the
    /// on-screen preview.
    #[test]
    fn closed_options_below_the_lower_threshold_use_scientific_notation_independently() {
        let template = make_template("Vypočítejte koncentraci.");
        let variant = Variant {
            numeric_options: Some(vec![0.0796, 0.1478]),
            correct_option: Some(1),
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(
            output.contains(" :r1 7,96×10<sup>-2</sup>"),
            "expected the below-threshold option in scientific notation, got:\n{output}"
        );
        assert!(
            output.contains(" :r2 0,15 "),
            "expected the at-or-above-threshold option as a plain decimal, got:\n{output}"
        );
    }

    #[test]
    fn open_intervals_use_scientific_notation_for_molecule_counts() {
        let template = make_template("Jaký počet molekul?");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(1.05e25),
            interval_hi: Some(1.35e25),
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(
            output.contains(":n=\"1,05×10<sup>25</sup>..1,35×10<sup>25</sup>\""),
            "expected HTML scientific interval, got:\n{output}"
        );
    }

    /// Reproduces a reported export: a ±30 % tolerance around 0.1137 mol
    /// printed at one decimal collapsed to `"0,1..0,1"`, which accepts only
    /// the rounded midpoint instead of the intended 0.08–0.15 band.
    #[test]
    fn small_answer_interval_does_not_collapse_to_a_single_value() {
        let template = make_template("Vypočítejte látkové množství.");
        let variant = Variant {
            interval_lo: Some(0.0796),
            interval_hi: Some(0.1478),
            numeric_options: None,
            correct_option: None,
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(
            output.contains(":n=\"0,08..0,15\""),
            "interval should keep both bounds distinguishable, got:\n{output}"
        );
        assert!(
            !output.contains("0,1..0,1"),
            "interval collapsed to a single value:\n{output}"
        );
    }

    /// Even far below the requested precision the bounds must stay apart.
    #[test]
    fn tiny_answer_interval_widens_precision_until_bounds_differ() {
        let template = make_template("Vypočítejte koncentraci.");
        let variant = Variant {
            interval_lo: Some(0.000_21),
            interval_hi: Some(0.000_39),
            numeric_options: None,
            correct_option: None,
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        let interval = output
            .lines()
            .find(|l| l.starts_with(":n="))
            .expect("interval line");
        let bounds: Vec<&str> = interval
            .trim_start_matches(":n=\"")
            .split("\"")
            .next()
            .expect("bounds")
            .split("..")
            .collect();
        assert_ne!(bounds[0], bounds[1], "bounds collapsed in {interval}");
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains("H<sub>2</sub>SO<sub>4</sub>"));
        assert!(output.contains("x<sup>2</sup>"));
        assert!(output.contains("32,0 ml"));
    }

    #[test]
    fn chained_compound_subscript_merges_into_one() {
        // K_a_1 names a single symbol (the first dissociation constant of
        // acid "a"), not two separate subscripts — the regex must not stop
        // after the first "_a" and leave a literal "_1" behind.
        let template = make_template("Konstanta K_a_1 pro [[X]] ml.");
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(output.contains("K<sub>a1</sub>"));
        assert!(!output.contains("K_a_1"));
        assert!(!output.contains("_1"));
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
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
                alternate_option: None,
                interval_lo: None,
                interval_hi: None,
            },
            crate::models::AnswerField {
                symbol: "m".to_string(),
                value: 4.0,
                unit: Some("g".to_string()),
                numeric_options: Some(vec![4.0, 3.2, 4.8, 5.0, 3.5]),
                correct_option: Some(1),
                alternate_option: None,
                interval_lo: None,
                interval_hi: None,
            },
        ]);
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains(" :r1 2,0 mol, 4,0 g"));
        assert!(output.contains(":r1 ok 3"));
    }

    /// When alternace is present the export must mark both the primary
    /// correct option (a) and the alternate (b) as ok, so a student picking
    /// either scores the points.
    #[test]
    fn closed_export_marks_both_correct_and_alternate_as_ok() {
        let template = make_template("Kolik gramů?");
        let variant = Variant {
            numeric_options: Some(vec![64.0, 60.0, 70.0, 58.0, 80.0]),
            correct_option: Some(1),
            alternate_option: Some(2),
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains(":r1 ok 3"), "primary correct must be marked ok");
        assert!(output.contains(":r2 ok 3"), "alternate must also be marked ok");
    }

    /// Same for multi-answer closed export: when the first target carries an
    /// alternate_option, both rows are marked ok.
    #[test]
    fn multi_answer_closed_export_marks_alternate_as_ok() {
        let template = make_template("Vypočítejte [n mol][m g]");
        let mut variant = make_closed_variant();
        variant.answers_data = Some(vec![
            crate::models::AnswerField {
                symbol: "n".to_string(),
                value: 2.0,
                unit: Some("mol".to_string()),
                numeric_options: Some(vec![2.0, 1.5, 2.5, 3.0, 1.0]),
                correct_option: Some(1),
                alternate_option: Some(2),
                interval_lo: None,
                interval_hi: None,
            },
            crate::models::AnswerField {
                symbol: "m".to_string(),
                value: 4.0,
                unit: Some("g".to_string()),
                numeric_options: Some(vec![4.0, 3.2, 4.8, 5.0, 3.5]),
                correct_option: Some(1),
                alternate_option: Some(2),
                interval_lo: None,
                interval_hi: None,
            },
        ]);
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains(":r1 ok 3"), "primary correct must be marked ok");
        assert!(output.contains(":r2 ok 3"), "alternate must also be marked ok");
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
                alternate_option: None,
                interval_lo: Some(1.8),
                interval_hi: Some(2.2),
            },
            crate::models::AnswerField {
                symbol: "m".to_string(),
                value: 4.0,
                unit: Some("g".to_string()),
                numeric_options: None,
                correct_option: None,
                alternate_option: None,
                interval_lo: Some(3.8),
                interval_hi: Some(4.2),
            },
        ]);
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("FeSO4.7H2O"));
        assert!(!output.contains("FeSO4×7H2O"));
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("FeSO4.7H<sub>2</sub>O"));
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("g.cm<sup>-3</sup>"));
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
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(output.contains("g.cm<sup>-3</sup>"));
        assert!(output.contains("1.5"));
    }

    fn make_template_with_sig(text: &str, sig: u8) -> Template {
        Template {
            id: Uuid::new_v4(),
            question_text: text.to_string(),
            formula: "X * 2".to_string(),
            equation_text: String::new(),
            numeric_answer: None,
            result_unit: "g".to_string(),
            point_value: 3,
            significant_digits: Some(sig),
            force_scientific: false,
            decoy_formula: None,
            alternative_formula: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn closed_options_use_significant_digits_when_set() {
        let template = make_template_with_sig("Vypočítejte hmotnost z [[X]] g.", 3);
        let variant = Variant {
            numeric_options: Some(vec![12.345, 67.891, 1.524493429448685e25]),
            correct_option: Some(2),
            ..make_closed_variant()
        };
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: Some(3),
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(
            output.contains(" :r1 12,3 g"),
            "expected 3 sig digits (12,3) for option 1, got:\n{output}"
        );
        assert!(
            output.contains(" :r2 67,9 g"),
            "expected 3 sig digits (67,9) for option 2, got:\n{output}"
        );
        assert!(
            output.contains(" :r3 1,52×10<sup>25</sup> g"),
            "expected 3 sig digits in scientific for option 3, got:\n{output}"
        );
    }

    #[test]
    fn open_interval_uses_significant_digits_when_set() {
        let template = make_template_with_sig("Vypočítejte koncentraci.", 3);
        let variant = Variant {
            interval_lo: Some(0.0796),
            interval_hi: Some(0.1478),
            numeric_options: None,
            correct_option: None,
            ..make_closed_variant()
        };
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: Some(3),
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(
            output.contains(":n=\"0,0796..0,148\""),
            "expected 3 sig digits interval bounds, got:\n{output}"
        );
    }

    #[test]
    fn result_falls_back_to_precision_when_no_sig_digits() {
        let template = make_template("Vypočítejte hmotnost z [[X]] g.");
        let variant = Variant {
            numeric_options: Some(vec![12.345, 67.891]),
            correct_option: Some(1),
            ..make_closed_variant()
        };
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        assert!(
            output.contains(" :r1 12,35 g"),
            "expected 2 max decimals (12,35) for option 1, got:\n{output}"
        );
    }

    #[test]
    fn significant_digits_round_large_numbers_to_correct_magnitude() {
        assert_eq!(fmt_significant_cz(111554.0, 2), "110000");
        assert_eq!(fmt_significant_cz(111554.0, 3), "112000");
        assert_eq!(fmt_significant_cz(111554.0, 4), "111600");
        assert_eq!(fmt_significant_cz(111554.0, 5), "111550");
        assert_eq!(fmt_significant_cz(111554.0, 6), "111554");
        assert_eq!(fmt_significant_cz(111554.0, 7), "111554,0");
    }

    #[test]
    fn per_variable_notation_scientific_forces_scientific_in_question_text() {
        let template = make_template("Hmotnost [[X]] g...");
        let variant = make_closed_variant();
        let precisions = [("X".to_string(), 1)].into();
        let mut notations: HashMap<String, Notation> = HashMap::new();
        notations.insert("X".to_string(), Notation::Scientific);
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: notations,
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);
        assert!(
            output.contains("3,20×10<sup>1</sup>"),
            "expected scientific notation for X in question text, got:\n{output}"
        );
    }

    #[test]
    fn per_variable_notation_normal_keeps_plain_decimal_in_question_text() {
        let template = make_template("Hmotnost [[X]] g...");
        let variant = make_closed_variant();
        let precisions = [("X".to_string(), 1)].into();
        let mut notations: HashMap<String, Notation> = HashMap::new();
        notations.insert("X".to_string(), Notation::Normal);
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: notations,
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);
        assert!(
            output.contains("32,0 g"),
            "expected plain decimal for X in question text, got:\n{output}"
        );
    }
}
