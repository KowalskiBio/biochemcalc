/// Extracts numeric literals and their units from Czech chemistry problem text.
///
/// # Behavior
///
/// 1. Parses numbers with both `.` and `,` as decimal separators.
/// 2. Handles scientific notation: `Mx10E`, `×10^E`, `x10^E`.
/// 3. Skips numbers that are part of chemical formulas (element subscripts,
///    hydrate coefficients). A number is skipped when it is directly adjacent
///    to an element symbol (`[A-Z][a-z]?`) on either side, or when it sits
///    between a hydrate dot (`.`) and an element symbol.
/// 4. Extracts the unit token after each number (stops at whitespace, comma,
///    period, `?`, or end of string).
/// 5. Returns variables in text order with their byte position.
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

/// A numeric value extracted from question text together with its unit and
/// byte position.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedValue {
    pub value: f64,
    pub unit: String,
    pub position: usize,
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Number of consecutive ASCII-digit bytes starting at `start`.
fn scan_digits(text: &str, start: usize) -> usize {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut pos = start;
    while pos < len && bytes[pos].is_ascii_digit() {
        pos += 1;
    }
    pos
}

/// True when the byte at `pos - 1` is the *last* character of an element
/// symbol: either a single uppercase letter (H, C, O, …) or a lowercase
/// letter preceded by an uppercase (the second char of Na, Cl, Fe, Cu, Ag,
/// …).
fn is_preceded_by_element(text: &str, pos: usize) -> bool {
    if pos == 0 {
        return false;
    }
    let bytes = text.as_bytes();
    let ch = bytes[pos - 1];
    if ch.is_ascii_uppercase() {
        return true;
    }
    if ch.is_ascii_lowercase() && pos >= 2 && bytes[pos - 2].is_ascii_uppercase() {
        return true;
    }
    false
}

/// True when the number at `[start, end)` is a chemical-formula subscript or
/// a hydrate coefficient that should be excluded from the variable list.
fn is_formula_number(text: &str, start: usize, end: usize) -> bool {
    let bytes = text.as_bytes();
    let len = bytes.len();

    // Left adjacency — number follows an element symbol directly.
    if is_preceded_by_element(text, start) {
        return true;
    }

    // Hydrate notation — number sits between '.' and an element symbol.
    if start > 0 && bytes[start - 1] == b'.' && end < len && bytes[end].is_ascii_uppercase() {
        return true;
    }

    // Right adjacency — number is directly followed by an element symbol.
    if end < len && bytes[end].is_ascii_uppercase() {
        return true;
    }

    false
}

/// Parse a full numeric literal starting at `start`.
///
/// Returns `(value, byte_index_after_number)` or `None`.
fn parse_full_number(text: &str, start: usize) -> Option<(f64, usize)> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut pos = start;

    // ---- integer part --------------------------------------------------
    while pos < len && bytes[pos].is_ascii_digit() {
        pos += 1;
    }

    // ---- optional decimal separator + fractional part ------------------
    if pos < len && (bytes[pos] == b'.' || bytes[pos] == b',') {
        let sep = pos;
        pos += 1;
        while pos < len && bytes[pos].is_ascii_digit() {
            pos += 1;
        }
        if pos == sep + 1 {
            // no digits after the separator — it is not a decimal point
            pos = sep;
        }
    }

    let mantissa_raw = &text[start..pos];
    let mantissa_str = mantissa_raw.replace(',', ".");
    let mantissa: f64 = mantissa_str.parse().ok()?;

    // ---- scientific-notation suffix ------------------------------------
    // Supported patterns:  x10E   x10^E   ×10E   ×10^E
    let rest = &text[pos..];
    let sci_skip = if rest.starts_with("\u{00d7}10^") {
        // ×10^   (× is 2 bytes, 10^ is 3 → 5 total)
        5
    } else if rest.starts_with("x10^") {
        4
    } else if rest.starts_with("*10^") {
        4
    } else if rest.starts_with(".10^") {
        4
    } else if rest.starts_with("\u{00d7}10") {
        // ×10    (× is 2 bytes, 10 is 2 → 4 total)
        4
    } else if rest.starts_with("x10") {
        3
    } else if rest.starts_with("*10") {
        3
    } else if rest.starts_with(".10") {
        3
    } else {
        0
    };

    if sci_skip > 0 {
        let mut exp_pos = pos + sci_skip;
        let mut neg = false;
        if exp_pos < len && bytes[exp_pos] == b'-' {
            neg = true;
            exp_pos += 1;
        }
        let exp_start = exp_pos;
        while exp_pos < len && bytes[exp_pos].is_ascii_digit() {
            exp_pos += 1;
        }
        if exp_start < exp_pos {
            let exp_str = &text[exp_start..exp_pos];
            let exp: i32 = exp_str.parse().ok()?;
            let exp = if neg { -exp } else { exp };
            return Some((mantissa * 10_f64.powi(exp), exp_pos));
        }
    }

    Some((mantissa, pos))
}

/// Extract the unit token starting at `pos` in `text`.
///
/// Skips leading whitespace, then collects characters until whitespace,
/// comma, period, `?`, or end of string. Returns the unit string and the
/// byte index after the trailing whitespace (so the caller can resume
/// scanning).
fn extract_unit(text: &str, pos: usize) -> (String, usize) {
    let bytes = text.as_bytes();
    let len = bytes.len();

    // skip leading whitespace
    let mut unit_start = pos;
    while unit_start < len && (bytes[unit_start] == b' ' || bytes[unit_start] == b'\t') {
        unit_start += 1;
    }

    // collect unit chars
    let mut unit_end = unit_start;
    while unit_end < len {
        let b = bytes[unit_end];
        if b == b' ' || b == b'\t' || b == b'\n' || b == b'?' || b == b',' || b == b'.' {
            break;
        }
        unit_end += 1;
    }

    let unit = text[unit_start..unit_end].to_string();

    // advance past trailing whitespace
    let mut next = unit_end;
    while next < len && (bytes[next] == b' ' || bytes[next] == b'\t') {
        next += 1;
    }

    (unit, next)
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/// Extract numeric literals and their units from Czech chemistry problem
/// text.
///
/// Returns variables in the order they appear, each with its byte position.
pub fn extract_variables(text: &str) -> Vec<ExtractedValue> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut results = Vec::new();
    let mut pos = 0;

    while pos < len {
        if !bytes[pos].is_ascii_digit() {
            pos += 1;
            continue;
        }

        let start = pos;
        let int_end = scan_digits(text, start);

        // Quick-reject on the integer part alone so that a hydrate dot or a
        // following element symbol does not get pulled into the decimal.
        if is_formula_number(text, start, int_end) {
            pos = int_end;
            continue;
        }

        // Full parse — may consume a decimal separator and/or sci-notation.
        let Some((value, end)) = parse_full_number(text, start) else {
            pos = int_end;
            continue;
        };

        // Re-check after extending with the decimal part.
        if is_formula_number(text, start, end) {
            pos = end;
            continue;
        }

        let (unit, next_pos) = extract_unit(text, end);
        results.push(ExtractedValue {
            value,
            unit,
            position: start,
        });
        pos = next_pos;
    }

    results
}

// ---------------------------------------------------------------------------
// fixed-value placeholders
// ---------------------------------------------------------------------------

static FIXED_PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[\[([^\]=\s]+)(?:=([^\]]*))?\]\]").expect("valid fixed-placeholder regex")
});

/// Extract placeholders of the form `[[symbol=value]]` from text and return
/// a map of symbol to numeric value.
///
/// Only placeholders that include an `=` and whose value parses as a number
/// (accepting either `.` or `,` as the decimal separator) are included.
/// If the same symbol appears multiple times, the first occurrence wins.
pub fn extract_fixed_placeholders(text: &str) -> HashMap<String, f64> {
    let mut result = HashMap::new();
    for cap in FIXED_PLACEHOLDER_RE.captures_iter(text) {
        let symbol = cap[1].trim().to_string();
        let Some(value_match) = cap.get(2) else {
            continue;
        };
        let value_str = value_match.as_str().trim().replace(',', ".");
        if let Some((value, end)) = parse_full_number(&value_str, 0) {
            if end == value_str.len() {
                result.entry(symbol).or_insert(value);
            }
        }
    }
    result
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_number_with_unit() {
        let vars = extract_variables("499.7 g");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 499.7).abs() < 1e-9);
        assert_eq!(vars[0].unit, "g");
    }

    #[test]
    fn chemical_formula_h2so4_returns_nothing() {
        let vars = extract_variables("H2SO4");
        assert!(vars.is_empty());
    }

    #[test]
    fn full_question_extracts_correct_pairs() {
        let text =
            "Jaký je hmotnostní zlomek H2SO4 v roztoku, jehož 976.1 g obsahuje 582.2 g H2SO4?";
        let vars = extract_variables(text);
        assert_eq!(vars.len(), 2);
        assert!((vars[0].value - 976.1).abs() < 1e-9);
        assert_eq!(vars[0].unit, "g");
        assert!((vars[1].value - 582.2).abs() < 1e-9);
        assert_eq!(vars[1].unit, "g");
    }

    #[test]
    fn multiple_values_with_kcl_formula() {
        let text = "22.2 g roztoku o hmotnostním zlomku KCl 0.129";
        let vars = extract_variables(text);
        assert_eq!(vars.len(), 2);
        assert!((vars[0].value - 22.2).abs() < 1e-9);
        assert_eq!(vars[0].unit, "g");
        assert!((vars[1].value - 0.129).abs() < 1e-9);
        assert_eq!(vars[1].unit, "");
    }

    #[test]
    fn scientific_notation_x100() {
        let vars = extract_variables("2.86x100 g");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 2.86).abs() < 1e-9);
        assert_eq!(vars[0].unit, "g");
    }

    #[test]
    fn scientific_notation_x103() {
        let vars = extract_variables("1.25x103 g");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 1250.0).abs() < 1e-9);
        assert_eq!(vars[0].unit, "g");
    }

    #[test]
    fn hydrate_formula_returns_nothing() {
        let vars = extract_variables("Na2SO3.7H2O");
        assert!(vars.is_empty());
    }

    #[test]
    fn czech_decimal_comma() {
        let vars = extract_variables("3,14");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 3.14).abs() < 1e-9);
        assert_eq!(vars[0].unit, "");
    }

    #[test]
    fn value_before_chemical_formula() {
        let vars = extract_variables("25.7 g KBr");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 25.7).abs() < 1e-9);
        assert_eq!(vars[0].unit, "g");
    }

    #[test]
    fn more_complex_hydrate_cuso4_5h2o() {
        let vars = extract_variables("CuSO4.5H2O");
        assert!(vars.is_empty());
    }

    #[test]
    fn percentage_unit() {
        let vars = extract_variables("50 %");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 50.0).abs() < 1e-9);
        assert_eq!(vars[0].unit, "%");
    }

    #[test]
    fn position_is_preserved() {
        let text = "abc 123 g xyz";
        let vars = extract_variables(text);
        assert_eq!(vars.len(), 1);
        let pos = vars[0].position;
        assert_eq!(&text[pos..pos + 3], "123");
    }

    #[test]
    fn integer_without_unit() {
        let vars = extract_variables("hmotnost je 42");
        assert_eq!(vars.len(), 1);
        assert!((vars[0].value - 42.0).abs() < 1e-9);
        assert_eq!(vars[0].unit, "");
    }

    #[test]
    fn fixed_placeholder_with_decimal_dot() {
        let text =
            "Molární koncentrace [[wperc=21.1]] % roztoku (hustota = [[rho_r=1.3083]] g·cm-3) je:";
        let fixed = extract_fixed_placeholders(text);
        assert_eq!(fixed.len(), 2);
        assert!((fixed["wperc"] - 21.1).abs() < 1e-9);
        assert!((fixed["rho_r"] - 1.3083).abs() < 1e-9);
    }

    #[test]
    fn fixed_placeholder_with_decimal_comma() {
        let text = "Hodnota je [[x=3,14]] a [[y=2,5]]";
        let fixed = extract_fixed_placeholders(text);
        assert_eq!(fixed.len(), 2);
        assert!((fixed["x"] - 3.14).abs() < 1e-9);
        assert!((fixed["y"] - 2.5).abs() < 1e-9);
    }

    #[test]
    fn fixed_placeholder_ignores_plain_placeholders() {
        let text = "Roztok obsahuje [[wperc]] % látky.";
        let fixed = extract_fixed_placeholders(text);
        assert!(fixed.is_empty());
    }

    #[test]
    fn fixed_placeholder_first_occurrence_wins() {
        let text = "[[a=1]] a později [[a=2]]";
        let fixed = extract_fixed_placeholders(text);
        assert_eq!(fixed.len(), 1);
        assert!((fixed["a"] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn fixed_placeholder_with_asterisk_scientific_notation() {
        let text = "[[Kb=1.8*10^-5]]";
        let fixed = extract_fixed_placeholders(text);
        assert_eq!(fixed.len(), 1);
        assert!((fixed["Kb"] - 1.8e-5).abs() < 1e-12);
    }

    #[test]
    fn fixed_placeholder_with_dot_scientific_notation() {
        let text = "[[Ka=3.53.10^-4]]";
        let fixed = extract_fixed_placeholders(text);
        assert_eq!(fixed.len(), 1);
        assert!((fixed["Ka"] - 3.53e-4).abs() < 1e-12);
    }

    #[test]
    fn fixed_placeholder_with_multiplication_sign_scientific_notation() {
        let text = "[[Ka=5.61×10^-11]]";
        let fixed = extract_fixed_placeholders(text);
        assert_eq!(fixed.len(), 1);
        assert!((fixed["Ka"] - 5.61e-11).abs() < 1e-15);
    }
}
