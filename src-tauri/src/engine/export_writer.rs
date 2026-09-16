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

/// The real minus sign (U+2212) a student reads, in place of the ASCII
/// hyphen-minus (U+002D) a keyboard types. A hyphen is a hyphen; raised to a
/// superscript or set before a negative number it is typographically the wrong
/// glyph, exactly like the hyphen-as-minus the teacher's units arrive with
/// (`mol.dm^-3`).
///
/// Scoped to strings this module itself formatted for display: placeholder
/// values, option values, superscript exponents and charges. Never applied to
/// raw teacher prose (a hyphen there can be a range `1-5` or a compound word)
/// and never to the `:n` evaluation rows or the bare `e`-notation inside them,
/// which IS MU parses back as numbers and would stop recognising.
///
/// A formatted number's only hyphen is its sign, so a blanket replace is
/// unambiguous here.
fn display_minus(s: &str) -> String {
    s.replace('-', "\u{2212}")
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
/// `SCIENTIFIC_LOWER_THRESHOLD` in `src/lib/math-utils.ts`. For `fmt_option_value`
/// this is a styling preference scoped to `Auto` mode — see
/// `SCIENTIFIC_WALL_OF_ZEROS_THRESHOLD` below for the separate, unconditional
/// correctness floor. `fmt_plain_decimal_cz` reuses the same threshold
/// unconditionally, since a `:n` evaluation row has no notation setting to
/// respect in the first place — see its doc comment.
const SCIENTIFIC_LOWER_THRESHOLD: f64 = 0.1;

/// Below this magnitude, a sig-fig-formatted decimal has so many leading
/// zeros that it stops being a legitimate "not scientific" rendering no
/// matter what the caller asked for. An atomic mass (~1e-22) at, say, 4
/// significant digits never rounds to a literal "0" (so the ordinary
/// zero-collapse fallback in `fmt_variable_value` never fires), yet printing
/// 20+ leading zeros is exactly the "wall of decimal zeros" that fallback
/// exists to avoid. Deliberately far below `SCIENTIFIC_LOWER_THRESHOLD` (an
/// `Auto`-mode readability preference) — this is a correctness floor, so it
/// applies even under an explicit `Notation::Normal` ("not scientific")
/// choice, in `fmt_option_value` only (see its own doc comment for why).
const SCIENTIFIC_WALL_OF_ZEROS_THRESHOLD: f64 = 1e-6;

/// Czech-formatted scientific notation with an HTML superscript exponent, the
/// same shape the UI renders and the same markup the exported question text
/// already uses for formulae (`H<sub>2</sub>O`, `cm<sup>-3</sup>`).
///
/// `mantissa_decimals` mirrors the UI: `SCIENTIFIC_MANTISSA_DECIMALS` (2) by
/// default, but `sigDigits - 1` when significant digits are configured, so
/// e.g. 4 significant digits shows a 3-decimal mantissa here exactly as it
/// does in `formatSignificantDigits` in `src/lib/math-utils.ts`.
/// Czech-formatted mantissa and exponent, shared by the HTML scientific form
/// (`fmt_scientific_cz`) and the bare `e`-notation form (`fmt_plain_scientific_cz`).
fn scientific_mantissa_cz(value: f64, mantissa_decimals: u8) -> (String, i32) {
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
    (fmt_cz(mantissa, mantissa_decimals), exponent)
}

fn fmt_scientific_cz(value: f64, mantissa_decimals: u8) -> String {
    if value == 0.0 || !value.is_finite() {
        return display_minus(&fmt_cz(value, mantissa_decimals));
    }
    let (mantissa, exponent) = scientific_mantissa_cz(value, mantissa_decimals);
    // Both minus positions render with the real minus sign: the negative
    // mantissa and the negative exponent. Only the HTML display form does
    // this; the bare `e`-notation sibling (`4e-5`) must stay parseable.
    format!(
        "{}×10<sup>{}{}</sup>",
        display_minus(&mantissa),
        if exponent < 0 { "\u{2212}" } else { "" },
        exponent.abs()
    )
}

/// Bare `e`-notation scientific form for a `:n` evaluation row: `4e-5`, not
/// `4×10<sup>-5</sup>`. The row is parsed as a plain number, so the HTML
/// markup `fmt_scientific_cz` produces would not survive — but `e`-notation
/// is itself valid number syntax, which is what makes it usable here at all.
/// See `fmt_plain_decimal_cz` for when this applies.
///
/// The mantissa's trailing zeros carry no information and are trimmed, so
/// the large-magnitude escape prints `2,072e26`, matching the significant
/// digits the teacher configured, instead of `2,072000000000e26`.
fn fmt_plain_scientific_cz(value: f64, mantissa_decimals: u8) -> String {
    if value == 0.0 || !value.is_finite() {
        return fmt_cz(value, mantissa_decimals);
    }
    let (mantissa, exponent) = scientific_mantissa_cz(value, mantissa_decimals);
    let mantissa = mantissa.trim_end_matches('0').trim_end_matches(',');
    format!("{mantissa}e{exponent}")
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
    static SCI_MUL_RE: OnceLock<Regex> = OnceLock::new();
    static DOT_MUL_RE: OnceLock<Regex> = OnceLock::new();

    let hydrate_re = HYDRATE_RE
        .get_or_init(|| Regex::new(r"([A-Za-z0-9)])[·.](\d*)(H[₂2_]?[_₂2]?O)\b").unwrap());
    let sup_re =
        SUP_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)(])\^([+-]?\d+[+-]?|[+-])").unwrap());
    // Chained compound subscripts (K_a_1 -> Ka1, one symbol, one subscript)
    // merge into a single <sub>; each "_xxx" segment stays non-greedy so
    // H_2SO_4 splits into two subscripts instead of swallowing "SO".
    let sub_re = SUB_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)])((?:_[A-Za-z0-9]+?)+)").unwrap());
    let star_mul_re =
        STAR_MUL_RE.get_or_init(|| Regex::new(r"([A-Za-z0-9)])[\*·]([A-Za-z0-9(])").unwrap());
    // Rust's regex crate has no lookahead, so the `10^` is captured and
    // written back out rather than matched as a zero-width assertion.
    let sci_mul_re = SCI_MUL_RE.get_or_init(|| Regex::new(r"[\*·.]10\^").unwrap());
    let dot_mul_re = DOT_MUL_RE.get_or_init(|| Regex::new(r"([A-Za-z])\.([A-Za-z])").unwrap());

    // A hydrate separator written as a DOT is not multiplication: `FeSO4.7H2O`
    // is iron(II) sulfate heptahydrate, not "4 times 7". Park it on a sentinel
    // no later rule matches, then restore it as a plain dot on the way out.
    // An asterisk is excluded on purpose: `*` always means multiplication, so
    // `FeSO_4*7H_2O` renders `FeSO₄×7H₂O`.
    let text = hydrate_re.replace_all(text, concat!("$1", "\u{1}", "$2$3"));
    // Czech scientific notation writes the power of ten as `3,53.10^-4` or
    // `1,8*10^-5`; that separator is multiplication. Runs while `^` is still
    // present, which is what marks the `10` as a power rather than a number.
    let text = sci_mul_re.replace_all(&text, "×10^");
    // The multiplication passes run BEFORE sub/sup: once `FeSO_4` has become
    // `FeSO<sub>4</sub>`, the character to the left of the `*` is `>`, which
    // no longer matches the operand class and the operator would survive.
    let text = star_mul_re.replace_all(&text, "$1×$2");
    // A dot is multiplication only between two letters, which separates a
    // unit product (`g.cm^-3`) from a sentence period (always followed by a
    // space or the end of the text) and from a decimal (digits both sides).
    let text = dot_mul_re.replace_all(&text, "$1×$2");
    // A `-` inside the superscript is a minus (an exponent like `-3`, a charge
    // like `2-`), so it takes the real minus sign; a `+` stays as typed.
    let text = sup_re.replace_all(&text, |caps: &regex::Captures| {
        format!(
            "{}<sup>{}</sup>",
            &caps[1],
            caps[2].replace('-', "\u{2212}")
        )
    });
    let text = sub_re.replace_all(&text, |caps: &regex::Captures| {
        format!("{}<sub>{}</sub>", &caps[1], caps[2].replace('_', ""))
    });
    text.replace('\u{1}', ".")
}

/// Apply chemical formatting so the exported static text matches the UI renderer.
fn format_text_segment(text: &str) -> String {
    // Decimal commas first: `format_chemical_text` turns `·`/`*` hydrate
    // separators into dots, and normalising afterwards could not tell those
    // freshly created dots apart from decimal points.
    format_chemical_text(&normalize_decimal_commas(text))
}

/// Rewrite decimal dots a teacher typed into question prose as Czech decimal
/// commas: `"objem 1.25 l"` → `"objem 1,25 l"`.
///
/// Mirrors `normalizeDecimalCommasInText` in `src/lib/utils.ts`, which
/// normalises on save; this pass is what keeps a question authored before
/// that, or imported straight into the database, from exporting with a
/// stray dot.
///
/// A dot between digits is not always a decimal point here: `FeSO4.7H2O` is
/// a hydrate, and `format_chemical_text` deliberately produces exactly that
/// dot from `·`/`*`. So a dot only converts when the digit run before it is
/// not preceded by a letter *and* the digit run after it is not followed by
/// one. The `regex` crate has no lookaround, hence the hand-rolled scan.
fn normalize_decimal_commas(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if !c.is_ascii_digit() {
            out.push(c);
            i += 1;
            continue;
        }

        // A run of digits, possibly followed by `.` and another run.
        let start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        let preceded_by_letter = start > 0 && chars[start - 1].is_alphabetic();

        // `.10^` is the multiplication separator of a Czech-written power of
        // ten (`3,53.10^-4`), not a decimal point. Skipping it is what makes
        // this function idempotent: without the check, a second pass reads
        // the `53.10` of an already-normalised `3,53.10^-4` as a fresh
        // decimal pair and writes `3,53,10^-4`, destroying the value.
        let power_of_ten_separator = chars.get(i + 1) == Some(&'1')
            && chars.get(i + 2) == Some(&'0')
            && chars.get(i + 3) == Some(&'^');

        let is_decimal = !preceded_by_letter
            && i < chars.len()
            && chars[i] == '.'
            && chars.get(i + 1).is_some_and(char::is_ascii_digit)
            && !power_of_ten_separator;

        if !is_decimal {
            out.extend(&chars[start..i]);
            continue;
        }

        let frac_start = i + 1;
        let mut frac_end = frac_start;
        while frac_end < chars.len() && chars[frac_end].is_ascii_digit() {
            frac_end += 1;
        }
        let followed_by_letter = chars.get(frac_end).is_some_and(|c| c.is_alphabetic());

        out.extend(&chars[start..i]);
        if followed_by_letter {
            // A hydrate such as `FeSO4.7H2O` reached through a `(` or `)`.
            out.push('.');
        } else {
            out.push(',');
        }
        out.extend(&chars[frac_start..frac_end]);
        i = frac_end;
    }

    out
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
    if want_scientific && value != 0.0 && value.is_finite() {
        return fmt_scientific_cz(value, mantissa_decimals);
    }
    // Regardless of notation — even an explicit `Normal` ("not scientific")
    // choice — a value that would either display as a misleading literal
    // "0" or need more decimal digits than an `f64` actually carries (a
    // huge value's fixed-point string is mostly float-representation noise
    // past ~15-17 significant digits) is never a legitimate plain-decimal
    // rendering. `Normal` only ever suppresses the *moderate*-magnitude
    // auto-threshold below (`fmt_option_value`'s `SCIENTIFIC_LOWER_THRESHOLD`
    // check), not this correctness escape hatch.
    match sig_digits {
        Some(n) => {
            let formatted = fmt_significant_cz(value, n);
            let rounded: f64 = formatted.replace(',', ".").parse().unwrap_or(value);
            let degenerate =
                (rounded == 0.0 && value != 0.0) || rounded.abs() >= SCIENTIFIC_UPPER_THRESHOLD;
            if degenerate && value != 0.0 && value.is_finite() {
                return fmt_scientific_cz(value, mantissa_decimals);
            }
            formatted
        }
        None => {
            let formatted = fmt_value_cz(value, precision);
            let rounded: f64 = formatted.replace(',', ".").parse().unwrap_or(value);
            if (rounded == 0.0 && value != 0.0) || rounded.abs() >= SCIENTIFIC_UPPER_THRESHOLD {
                return fmt_scientific_cz(value, mantissa_decimals);
            }
            formatted
        }
    }
}

/// Format one multiple-choice option: same as `fmt_variable_value`, with two
/// magnitude-based overrides layered on top. Scoped to options only — not
/// reused for open-answer interval bounds, which already have their own
/// joint "both bounds must stay distinguishable" precision logic and
/// intentionally keep small-but-ordinary values (e.g. `0,08..0,15`) as plain
/// decimals.
///
/// - In `Auto` mode only, values below `SCIENTIFIC_LOWER_THRESHOLD` switch to
///   scientific as a readability preference — an explicit `Notation::Normal`
///   (the teacher's own "not scientific" choice) or `Notation::Scientific`
///   must never be second-guessed by it.
/// - Below `SCIENTIFIC_WALL_OF_ZEROS_THRESHOLD`, scientific notation applies
///   regardless of notation: an atomic mass (~1e-22) formatted with, say, 4
///   significant digits never rounds to "0" at any precision
///   `fmt_variable_value` would try, so its zero-collapse fallback never
///   fires and it would otherwise print as a wall of decimal zeros — a
///   correctness floor, not a style choice.
fn fmt_option_value(
    value: f64,
    precision: u8,
    sig_digits: Option<u8>,
    notation: Notation,
) -> String {
    let auto_below_threshold =
        notation == Notation::Auto && value.abs() < SCIENTIFIC_LOWER_THRESHOLD;
    let wall_of_zeros = value.abs() < SCIENTIFIC_WALL_OF_ZEROS_THRESHOLD;
    if (auto_below_threshold || wall_of_zeros) && value != 0.0 && value.is_finite() {
        let mantissa_decimals = sig_digits
            .map(|n| n.saturating_sub(1))
            .unwrap_or(SCIENTIFIC_MANTISSA_DECIMALS);
        return fmt_scientific_cz(value, mantissa_decimals);
    }
    fmt_variable_value(value, precision, sig_digits, notation)
}

/// Decimal places for a symbol the template has no precision setting for.
/// Kept as the historical fallback so a value that would collapse to "0" at
/// one decimal place still reaches `fmt_variable_value`'s zero-collapse
/// escape into scientific notation.
const DEFAULT_VARIABLE_PRECISION: u8 = 1;

/// Cap on decimal places derived from a literal or a value, mirroring the
/// `precision <= 10` limit `Variable::validate` enforces.
const MAX_DERIVED_DECIMALS: u8 = 10;

/// Fractional digits written in a fixed placeholder literal: `[[rho=1.3083]]`
/// -> 4, `[[X=2]]` -> 0, `[[Ka=1.8x10^-5]]` -> 1 (the mantissa's). The digits
/// come from the text rather than the parsed `f64` so a literal's trailing
/// zeros survive: `[[rho=1,3000]]` is a five-significant-digit density, not
/// `1,3`.
///
/// `None` when the right-hand side is not a number at all, i.e. the linked
/// form `[[Ka=wac]]`, whose value comes from a string variable's paired
/// constants.
fn literal_decimals(literal: &str) -> Option<u8> {
    let mantissa = literal
        .trim()
        .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .next()
        .unwrap_or("");
    if !mantissa.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    let decimals = match mantissa.find(['.', ',']) {
        Some(pos) => mantissa[pos + 1..]
            .chars()
            .filter(char::is_ascii_digit)
            .count(),
        None => 0,
    };
    Some(decimals.min(MAX_DERIVED_DECIMALS as usize) as u8)
}

/// Decimal places a value carries on its own, for a symbol with neither a
/// configured precision nor a literal to read them from, i.e. a databáze
/// paired constant, which arrives already rounded to the digits the teacher
/// entered.
/// The tolerance keeps float noise (`0.30000000000000004`) from asking for
/// all ten decimals.
///
/// Values too small to survive one decimal place keep
/// `DEFAULT_VARIABLE_PRECISION`, so an equilibrium constant still exports as
/// `1,80×10<sup>−5</sup>` (with the real minus sign, U+2212) rather than a
/// wall of leading zeros.
fn natural_decimals(value: f64) -> u8 {
    if !value.is_finite() || value == 0.0 {
        return DEFAULT_VARIABLE_PRECISION;
    }
    let collapses_to_zero = fmt_cz(value, DEFAULT_VARIABLE_PRECISION)
        .replace(',', ".")
        .parse::<f64>()
        == Ok(0.0);
    if collapses_to_zero {
        return DEFAULT_VARIABLE_PRECISION;
    }
    let tolerance = value.abs() * 1e-12;
    for decimals in 0..=MAX_DERIVED_DECIMALS {
        let formatted = format!("{:.*}", decimals as usize, value);
        if let Ok(parsed) = formatted.parse::<f64>() {
            if (parsed - value).abs() <= tolerance {
                return decimals.max(DEFAULT_VARIABLE_PRECISION);
            }
        }
    }
    MAX_DERIVED_DECIMALS
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
        let (lookup_key, fixed_literal) = match symbol.find('=') {
            Some(pos) => (&symbol[..pos], Some(&symbol[pos + 1..])),
            None => (symbol, None),
        };
        let has_eq = fixed_literal.is_some();
        if let Some(&value) = assigned.get(lookup_key) {
            // What the teacher wrote in the question text outranks any
            // precision stored for the symbol: a fixed `[[rho_r=1.3083]]`
            // reaches the generator as a value, but the bulk importer files
            // its variable row with `precision: 0`, and the old one-decimal
            // fallback covered every symbol that has no row at all (a
            // databáze paired constant). Either way a five-significant-digit
            // density used to export as `1,3`, while the on-screen preview,
            // which prints the literal verbatim, showed all five.
            let precision = fixed_literal
                .and_then(literal_decimals)
                .or_else(|| precisions.get(lookup_key).copied())
                .unwrap_or_else(|| natural_decimals(value));
            let sig_digits = significant_digits.get(lookup_key).copied();
            let notation = notations.get(lookup_key).copied().unwrap_or(Notation::Auto);
            rendered.push_str(&display_minus(&fmt_variable_value(
                value, precision, sig_digits, notation,
            )));
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

/// Per-option significant-digit override for option `idx`, if this option
/// belongs to a decoy (or is the alternace) configured with its own
/// significant digits. `None` falls back to the template-level setting.
fn option_sig_override(per_option: Option<&[Option<u8>]>, idx: usize) -> Option<u8> {
    per_option.and_then(|v| v.get(idx).copied().flatten())
}

/// Decimals needed to print every option in one set as a distinct number.
///
/// Mirrors `resolveOptionsPrecision` in `src/lib/math-utils.ts`, which the
/// on-screen option lists already use. The generator only guarantees that
/// options are distinct on its own rounding grid, and an SD window
/// (a percent of the answer, converted to an absolute half-width) makes
/// that grid `2*sd/(count+1)` — finer than the two decimals an export
/// prints. A question built around a narrow SD percent at ~1,0 then reaches
/// the student as `1,00 / 0,99 / 0,99 / 1,01 / 1,01`: five options, three
/// values. Significant digits are left alone, since there the grid and the
/// rendering are the same setting — except per-option overrides, which are
/// honored per value so a decoy with its own setting still renders
/// distinctly.
fn options_precision(
    values: &[f64],
    preferred: u8,
    sig_digits: Option<u8>,
    notation: Notation,
    per_option_sig: Option<&[Option<u8>]>,
) -> u8 {
    const MAX_PRECISION: u8 = 6;
    let any_override = per_option_sig.is_some_and(|v| v.iter().any(|s| s.is_some()));
    if (sig_digits.is_some() && !any_override) || values.len() < 2 {
        return preferred;
    }
    let mut precision = preferred;
    while precision < MAX_PRECISION {
        let mut rendered: Vec<String> = values
            .iter()
            .enumerate()
            .map(|(i, v)| {
                fmt_option_value(
                    *v,
                    precision,
                    option_sig_override(per_option_sig, i).or(sig_digits),
                    notation,
                )
            })
            .collect();
        let total = rendered.len();
        rendered.sort();
        rendered.dedup();
        if rendered.len() == total {
            return precision;
        }
        precision += 1;
    }
    MAX_PRECISION
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

    // Per target, exactly as the practice UI resolves one precision per slot.
    let precisions: Vec<u8> = answers
        .iter()
        .map(|a| {
            options_precision(
                a.numeric_options.as_deref().unwrap_or(&[]),
                precision,
                sig_digits,
                notation,
                a.option_sig_digits.as_deref(),
            )
        })
        .collect();

    for idx in 0..option_count {
        let label = idx + 1;
        let parts: Vec<String> = answers
            .iter()
            .zip(&precisions)
            .map(|(a, &precision)| {
                let value = a.numeric_options.as_ref().unwrap()[idx];
                let unit = a.unit.as_deref().unwrap_or("");
                // A decoy's (or the alternace's) own significant-digits
                // override applies to just this option.
                let sig = option_sig_override(a.option_sig_digits.as_deref(), idx).or(sig_digits);
                if unit.is_empty() {
                    display_minus(&fmt_option_value(value, precision, sig, notation))
                } else {
                    format!(
                        "{} {}",
                        display_minus(&fmt_option_value(value, precision, sig, notation)),
                        format_chemical_text(unit)
                    )
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
///
/// The ceiling has to clear the smallest answers a chemistry question asks
/// for. A `:n` row is a bare decimal (no `×10^x`), so the only way to keep
/// the bounds of a ~1e-22 tolerance apart is decimals, and a tolerance that
/// is now a true percentage of the answer (rather than a flat ±0,01) reaches
/// that far down. A magnitude that needs twenty of them is the teacher's cue
/// to ask for the answer in a different unit.
fn interval_precision(lo: f64, hi: f64, preferred: u8) -> u8 {
    const MAX_PRECISION: u8 = 30;
    let mut precision = preferred;
    while precision < MAX_PRECISION && fmt_cz(lo, precision) == fmt_cz(hi, precision) {
        precision += 1;
    }
    precision
}

/// IS MU caps a `:n` evaluation value at 15 digits: the reported rejection
/// reads "Hodnota musí být číslo, které může obsahovat maximálně 15 číslic."
/// A plain rendering that would run wider (a molecule count of ~2×10^26
/// spelled out is 27 digits) switches to e-notation instead, which IS MU
/// parses the same way it already parses the sub-0,1 bounds (`7,96e-2`,
/// `3e-5`).
const IS_MU_MAX_DIGITS: i32 = 15;

/// Mantissa decimals for the large-magnitude e-notation escape of
/// `fmt_plain_decimal_cz`: everything an `f64` actually justifies (its
/// binary expansion shows noise past ~15 significant digits) and IS MU's
/// digit cap leaves room for, once the exponent's own digits are counted.
fn large_mantissa_decimals(order: i32) -> u8 {
    /// Decimal digits a `f64` can justify before its binary expansion shows.
    const EXACT_DIGITS: i32 = 15;
    let exponent_digits = order.unsigned_abs().to_string().len() as i32;
    (EXACT_DIGITS.min(IS_MU_MAX_DIGITS - exponent_digits) - 1).clamp(0, 14) as u8
}

/// A plain decimal with `decimals` places for a `:n` evaluation row: a bare
/// number IS MU parses back, never the HTML `×10<sup>` form (see
/// `fmt_plain_scientific_cz`).
///
/// Two escapes keep the row readable as a number: below
/// `SCIENTIFIC_LOWER_THRESHOLD` (a wall of leading zeros) and above whatever
/// magnitude makes the plain rendering wider than IS MU's 15-digit cap, the
/// value switches to bare `e`-notation (`4e-5`, `2,072e26`). Unlike
/// `fmt_option_value`'s use of the same threshold, there is no `Notation`
/// setting to respect here: a `:n` row has no styling choice to begin with,
/// only the constraint that IS MU can read it back as a number.
///
/// In the small-value escape, `decimals` already carries the caller's
/// intended precision at that magnitude, so it converts directly to mantissa
/// decimals (`decimals + order`): the value was already rounded onto that
/// decimal grid before reaching here, and re-expressing it in scientific
/// form must not round it again. The large-value escape takes as many
/// mantissa digits as the cap leaves room for (see
/// `large_mantissa_decimals`), which on the significant-digit grids this
/// generator produces is every digit the value carries.
fn fmt_plain_decimal_cz(value: f64, decimals: u8) -> String {
    if value == 0.0 || !value.is_finite() {
        return fmt_cz(value, decimals);
    }
    let order = value.abs().log10().floor() as i32;
    if value.abs() < SCIENTIFIC_LOWER_THRESHOLD {
        let mantissa_decimals = (decimals as i32 + order).max(0) as u8;
        return fmt_plain_scientific_cz(value, mantissa_decimals);
    }
    if order + 1 + decimals as i32 > IS_MU_MAX_DIGITS {
        return fmt_plain_scientific_cz(value, large_mantissa_decimals(order));
    }
    fmt_cz(value, decimals)
}

/// `fmt_significant_cz` without the scientific escape hatch, for numbers
/// that have to reach IS MU as bare decimals or e-notation. Rounding to a
/// whole magnitude goes through digit padding while the result stays inside
/// IS MU's 15-digit cap, and past it through e-notation with the teacher's
/// own significant digits in the mantissa, so `2,072×10^26` at 4 significant
/// digits exports as `2,072e26` instead of the 27-digit plain form IS MU
/// rejects outright.
fn fmt_plain_significant_cz(value: f64, sig_digits: u8) -> String {
    if value == 0.0 || !value.is_finite() {
        return fmt_significant_cz(value, sig_digits);
    }
    let order = value.abs().log10().floor() as i32;
    let decimals = sig_digits as i32 - 1 - order;
    if decimals <= 0 {
        if order + 1 > IS_MU_MAX_DIGITS {
            let exponent_digits = order.unsigned_abs().to_string().len() as i32;
            let cap = (IS_MU_MAX_DIGITS - exponent_digits - 1).clamp(0, 14) as u8;
            // `sig_digits` significant digits means `sig_digits - 1` mantissa
            // decimals (one digit sits before the decimal point in normalized
            // scientific notation) — passing `sig_digits` itself here printed
            // one extra digit, e.g. `2,0723e26` instead of `2,072e26` for 4
            // significant digits, whenever the true 4th digit wasn't a
            // trailing zero that `fmt_plain_scientific_cz` trims away.
            return fmt_plain_scientific_cz(value, sig_digits.saturating_sub(1).min(cap));
        }
        let shift = -decimals;
        let head = (value / 10f64.powi(shift)).round();
        return format!("{:.0}{}", head, "0".repeat(shift as usize));
    }
    fmt_plain_decimal_cz(value, decimals.min(u8::MAX as i32) as u8)
}

/// Round `value` away from the interval's middle: the lower bound down, the
/// upper bound up, onto the grid the bound is about to be printed on.
///
/// Rounding to nearest can pull a bound inside the tolerance the generator
/// computed, and the student grading uses that same tolerance, so a printed
/// bound that clips it marks a genuinely correct answer wrong. Erring outward
/// instead can only ever accept one printed step more than intended.
/// `decimals` is signed: negative means rounding onto a whole power of ten,
/// which is how the significant-digit path treats large magnitudes.
fn round_outward(value: f64, decimals: i32, up: bool) -> f64 {
    let factor = 10f64.powi(decimals);
    if !value.is_finite() || !factor.is_finite() || factor <= 0.0 {
        return value;
    }
    let scaled = value * factor;
    if !scaled.is_finite() {
        return value;
    }
    // A bound that already sits on the grid must stay put: `2.2 * 100` is
    // 220.00000000000003 in binary, and ceiling that would publish 2,21.
    let nearest = scaled.round();
    if (scaled - nearest).abs() <= scaled.abs().max(1.0) * 1e-9 {
        return nearest / factor;
    }
    (if up { scaled.ceil() } else { scaled.floor() }) / factor
}

/// The two bounds of an answer interval as an IS MU `:n` evaluation row needs
/// them: a bare number or `lo..hi`, decimal comma or dot, nothing else.
///
/// The HTML scientific form the question's own numbers use elsewhere
/// (`×10<sup>25</sup>`) is never an option here, however those numbers are
/// styled — the row is parsed as a number, and that markup would not parse.
/// Bare `e`-notation is different: `fmt_plain_decimal_cz` switches to it both
/// below `SCIENTIFIC_LOWER_THRESHOLD` and above IS MU's 15-digit cap, because
/// `4e-5` and `2,072e26` parse as numbers just fine.
fn fmt_interval_bounds(
    lo: f64,
    hi: f64,
    result_precision: u8,
    result_sig_digits: Option<u8>,
) -> (String, String) {
    match result_sig_digits {
        Some(n) => (
            fmt_plain_significant_cz(round_outward(lo, significant_decimals(lo, n), false), n),
            fmt_plain_significant_cz(round_outward(hi, significant_decimals(hi, n), true), n),
        ),
        None => {
            // The precision is chosen on the honestly rounded bounds, so the
            // "both ends must stay distinguishable" escalation is unaffected
            // by the outward nudge applied when they are finally printed.
            let precision = interval_precision(lo, hi, result_precision);
            (
                fmt_plain_decimal_cz(round_outward(lo, precision as i32, false), precision),
                fmt_plain_decimal_cz(round_outward(hi, precision as i32, true), precision),
            )
        }
    }
}

/// Decimal places `sig_digits` significant digits put `value` on. Negative for
/// magnitudes whose last significant digit sits left of the decimal point.
fn significant_decimals(value: f64, sig_digits: u8) -> i32 {
    if value == 0.0 || !value.is_finite() {
        return 0;
    }
    sig_digits as i32 - 1 - value.abs().log10().floor() as i32
}

/// The unit as it trails an input field in the question part. It belongs
/// there and nowhere else: an evaluation row that carries anything but `ok`,
/// points and feedback after the answer swallows it as feedback text, leaving
/// the question with no row marked `ok`.
///
/// Two spaces because IS MU drops one space on each side of a manipulation
/// element, so that an element can be butted straight against its text.
fn field_unit_suffix(unit: &str) -> String {
    let unit = format_chemical_text(unit.trim());
    if unit.is_empty() {
        String::new()
    } else {
        format!("  {}", unit)
    }
}

/// A single numeric input field plus the row that grades it.
fn render_open_interval(
    out: &mut String,
    lo: f64,
    hi: f64,
    unit: &str,
    point_value: u8,
    result_precision: u8,
    result_sig_digits: Option<u8>,
) {
    let (lo_str, hi_str) = fmt_interval_bounds(lo, hi, result_precision, result_sig_digits);
    out.push_str(&format!(" :n{}\n", field_unit_suffix(unit)));
    out.push_str(&format!(":n={}..{} ok {}\n", lo_str, hi_str, point_value));
}

/// One numbered input field per answer target, graded on a single row.
///
/// All the elements share one row on purpose: that is how IS MU expresses "the
/// points are awarded only when every part is right", which is the rule the
/// old single-interval row carried. A row per element would instead pay
/// `point_value` per field.
fn render_multi_open_intervals(
    out: &mut String,
    answers: &[crate::models::AnswerField],
    point_value: u8,
    result_precision: u8,
    result_sig_digits: Option<u8>,
) {
    for (idx, a) in answers.iter().enumerate() {
        let symbol = format_chemical_text(a.symbol.trim());
        let label = if symbol.is_empty() {
            String::new()
        } else {
            format!("{} =  ", symbol)
        };
        out.push_str(&format!(
            " {}:n{}{}\n",
            label,
            idx + 1,
            field_unit_suffix(a.unit.as_deref().unwrap_or(""))
        ));
    }

    let mut row = String::new();
    for (idx, a) in answers.iter().enumerate() {
        let lo = a.interval_lo.expect("open answer field has lower bound");
        let hi = a.interval_hi.expect("open answer field has upper bound");
        let (lo_str, hi_str) = fmt_interval_bounds(lo, hi, result_precision, result_sig_digits);
        row.push_str(&format!(":n{}={}..{}", idx + 1, lo_str, hi_str));
    }
    out.push_str(&format!("{} ok {}\n", row, point_value));
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

/// This question's answer targets, or None when it has none.
///
/// `answers_data` carries `Some(vec![])` for a question whose formula uses
/// `;` assignments but whose text has no `[symbol]` markers, which is a
/// single-answer question however the field is shaped.
fn multi_answer_fields<'a>(q: &'a ExportQuestion<'_>) -> Option<&'a [crate::models::AnswerField]> {
    q.variant
        .answers_data
        .as_deref()
        .filter(|fields| !fields.is_empty())
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

        // `force_scientific` is the teacher's own binary choice (`12300` vs
        // `1.23×10⁴`), not a hint for an auto-magnitude heuristic — "off"
        // must mean plain decimal outright, not "decimal unless small".
        let result_notation = if q.force_scientific {
            Notation::Scientific
        } else {
            Notation::Normal
        };

        match q.mode {
            TemplateMode::Closed => {
                // An empty `answers_data` is not a multi-answer question: a
                // `;`-assignment formula with no `[symbol]` markers generates
                // `Some(vec![])`, and the multi-answer renderers index target
                // 0. Same non-empty test the student-facing paths use
                // (`answer_slots`, `grade_open`, `correct_answers`).
                if let Some(answers) = multi_answer_fields(q) {
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
                    let precision = options_precision(
                        numeric,
                        q.result_precision,
                        q.result_significant_digits,
                        result_notation,
                        q.variant.option_sig_digits.as_deref(),
                    );
                    for (idx, value) in numeric.iter().enumerate() {
                        let label = idx + 1;
                        // A decoy's (or the alternace's) own significant-digits
                        // override applies to just this option.
                        let sig = option_sig_override(q.variant.option_sig_digits.as_deref(), idx)
                            .or(q.result_significant_digits);
                        out.push_str(&format!(
                            " :r{} {} {}\n",
                            label,
                            display_minus(&fmt_option_value(
                                *value,
                                precision,
                                sig,
                                result_notation
                            )),
                            format_chemical_text(&q.template.result_unit)
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
                if let Some(answers) = multi_answer_fields(q) {
                    render_multi_open_intervals(
                        &mut out,
                        answers,
                        q.template.point_value,
                        q.result_precision,
                        q.result_significant_digits,
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
                    render_open_interval(
                        &mut out,
                        lo,
                        hi,
                        &q.template.result_unit,
                        q.template.point_value,
                        q.result_precision,
                        q.result_significant_digits,
                    );
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
            alternative_significant_digits: None,
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

    fn make_fixed_variant(values: [(String, f64); 2]) -> Variant {
        Variant::new(
            Uuid::new_v4(),
            values.into(),
            HashMap::new(),
            64.0,
            Some(vec![64.0, 70.0, 58.0, 80.0, 60.0]),
            Some(1),
            None,
            None,
            1,
        )
    }

    fn export_question_text(
        template: &Template,
        variant: &Variant,
        precisions: HashMap<String, u8>,
    ) -> String {
        write_txt(&[ExportQuestion {
            template,
            variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }])
    }

    /// A fixed `[[rho_r=1.3083]]` literal is the teacher's own text: every
    /// digit written there belongs in the exported test. The old one-decimal
    /// fallback cut a five-significant-digit density down to `1,3`.
    #[test]
    fn fixed_placeholder_keeps_every_digit_the_teacher_typed() {
        let template = make_template("Hustota roztoku je [[rho_r=1.3083]] g a [[wperc=21.1]] %.");
        let variant =
            make_fixed_variant([("rho_r".to_string(), 1.3083), ("wperc".to_string(), 21.1)]);
        let output = export_question_text(&template, &variant, HashMap::new());

        assert!(
            output.contains("Hustota roztoku je 1,3083 g a 21,1 %."),
            "fixed literal lost digits in:\n{output}"
        );
    }

    /// The bulk importer files a fixed placeholder's variable row with
    /// `precision: 0`, which must not override the digits in the text.
    #[test]
    fn fixed_placeholder_outranks_a_stored_precision() {
        let template = make_template("Hustota roztoku je [[rho_r=1.3083]] g a [[wperc=21.1]] %.");
        let variant =
            make_fixed_variant([("rho_r".to_string(), 1.3083), ("wperc".to_string(), 21.1)]);
        let precisions = [("rho_r".to_string(), 0), ("wperc".to_string(), 0)].into();
        let output = export_question_text(&template, &variant, precisions);

        assert!(
            output.contains("Hustota roztoku je 1,3083 g a 21,1 %."),
            "stored precision overrode the literal in:\n{output}"
        );
    }

    /// Trailing zeros are significant figures: `1,3000` is a five-digit
    /// density, and reading the digit count off the parsed `f64` would print
    /// it as `1,3`.
    #[test]
    fn fixed_placeholder_keeps_trailing_zeros() {
        let template = make_template("Hustota je [[rho=1.3000]] g a [[wperc=20]] %.");
        let variant = make_fixed_variant([("rho".to_string(), 1.3), ("wperc".to_string(), 20.0)]);
        let output = export_question_text(&template, &variant, HashMap::new());

        assert!(
            output.contains("Hustota je 1,3000 g a 20 %."),
            "trailing zeros lost in:\n{output}"
        );
    }

    /// A databáze paired constant has no variable row and no literal, so its
    /// own digits are all there is to go on.
    #[test]
    fn unconfigured_constant_keeps_its_own_digits() {
        let template = make_template("Hustota je [[rho]] g.");
        let variant = make_fixed_variant([("rho".to_string(), 1.0287), ("X".to_string(), 32.0)]);
        let output = export_question_text(&template, &variant, HashMap::new());

        assert!(
            output.contains("Hustota je 1,0287 g."),
            "paired constant lost digits in:\n{output}"
        );
    }

    /// An unconfigured constant too small for a plain decimal still escapes
    /// to scientific notation instead of printing leading zeros.
    #[test]
    fn unconfigured_tiny_constant_stays_scientific() {
        let template = make_template("Disociační konstanta je [[Ka]].");
        let variant = make_fixed_variant([("Ka".to_string(), 1.8e-5), ("X".to_string(), 32.0)]);
        let output = export_question_text(&template, &variant, HashMap::new());

        assert!(
            output.contains("1,80×10<sup>\u{2212}5</sup>"),
            "tiny constant did not stay scientific in:\n{output}"
        );
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

        assert!(
            output.contains(" :n  g\n"),
            "missing open marker in:\n{output}"
        );
        assert!(
            output.contains(":n=45,1..45,9 ok 3"),
            "missing interval in:\n{output}"
        );
        assert!(
            !output.contains(":r"),
            "closed-style options leaked into an open export:\n{output}"
        );
    }

    #[test]
    fn large_values_export_as_html_scientific_notation() {
        assert_eq!(
            fmt_value_cz(1.524493429448685e25, 2),
            "1,52×10<sup>25</sup>"
        );
        assert_eq!(fmt_value_cz(6.022e23, 2), "6,02×10<sup>23</sup>");
        assert_eq!(
            fmt_value_cz(-1.8433287150633585e25, 2),
            "\u{2212}1,84×10<sup>25</sup>"
        );
        assert_eq!(fmt_value_cz(5.2149e24, 2), "5,21×10<sup>24</sup>");
    }

    #[test]
    fn tiny_values_export_as_html_scientific_notation() {
        assert_eq!(fmt_value_cz(0.0000123, 2), "1,23×10<sup>\u{2212}5</sup>");
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
            output.contains(" :r1 3,440×10<sup>\u{2212}22</sup>"),
            "expected 4-sig-digit HTML scientific notation, got:\n{output}"
        );
        assert!(
            !output.contains("00000000000000000000"),
            "raw decimal expansion leaked into the export:\n{output}"
        );
    }

    /// `force_scientific: false` is the teacher's explicit "not scientific"
    /// choice (`12300`, not `1.23×10⁴`) — it must hold for every option
    /// regardless of that option's own magnitude. Previously a below-0.1
    /// option silently flipped to scientific notation anyway (mixing
    /// `7,96×10⁻²` alongside a sibling `0,15`), contradicting the setting the
    /// teacher actually chose; this is the regression test for that fix.
    #[test]
    fn closed_options_stay_decimal_when_force_scientific_is_off_regardless_of_magnitude() {
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
            !output.contains("×10"),
            "no option should use scientific notation when force_scientific is off:\n{output}"
        );
        assert!(
            output.contains(" :r1 0,08 "),
            "expected the below-threshold option as a plain decimal, got:\n{output}"
        );
        assert!(
            output.contains(" :r2 0,15 "),
            "expected the at-or-above-threshold option as a plain decimal, got:\n{output}"
        );
    }

    /// A `:n` row is parsed as a number, so a molecule count has to stay a
    /// bare number, and IS MU caps those at 15 digits: `1,05×10^25` written
    /// out in full is 26 digits and gets the whole file rejected. It exports
    /// as e-notation instead, which IS MU already parses for the sub-0,1
    /// bounds. The digits past what an `f64` carries must be zeros, not the
    /// binary expansion `{:.0}` would otherwise print.
    #[test]
    fn open_intervals_write_molecule_counts_as_e_notation() {
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
            output.contains(":n=1,05e25..1,35e25 ok 3"),
            "expected an e-notation interval, got:\n{output}"
        );
        assert!(
            !output.contains("<sup>"),
            "HTML markup leaked into a numeric row:\n{output}"
        );
        assert!(
            !output.contains("10500000000000000000000000"),
            "a plain digit run longer than IS MU's cap leaked into the export:\n{output}"
        );
    }

    /// The reported IS MU rejection: "Odpověď „number" obsahuje nepodporovanou
    /// hodnotu … Hodnota musí být číslo, které může obsahovat maximálně 15
    /// číslic." A molecule-count tolerance at ~2×10^26 with 4 significant
    /// digits used to export as 27-digit plain bounds. The significant-digit
    /// path must switch to e-notation too, keeping the teacher's 4 digits in
    /// the mantissa.
    #[test]
    fn huge_significant_digit_bounds_export_as_e_notation_within_the_digit_cap() {
        let template = make_template("Jaký počet molekul obsahuje za normálních podmínek chlor?");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(2.072e26),
            interval_hi: Some(2.094e26),
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
            mode: TemplateMode::Open,
        }]);

        assert!(
            output.contains(":n=2,072e26..2,094e26 ok 3"),
            "expected the teacher's 4 significant digits as e-notation, got:\n{output}"
        );
        assert!(
            !output.contains("207200000000000000000000000"),
            "a 27-digit plain bound leaked into the export:\n{output}"
        );

        // Every bound stays within IS MU's 15-digit cap and parses as a
        // number, exactly what IS MU does with the row.
        let row = output
            .lines()
            .find(|l| l.starts_with(":n="))
            .expect("evaluation row");
        for bound in row
            .trim_start_matches(":n=")
            .split(" ok")
            .next()
            .expect("bounds")
            .split("..")
        {
            let digits = bound.chars().filter(|c| c.is_ascii_digit()).count();
            assert!(
                digits <= IS_MU_MAX_DIGITS as usize,
                "bound {bound} exceeds IS MU's 15-digit cap"
            );
            bound
                .replace(',', ".")
                .parse::<f64>()
                .unwrap_or_else(|_| panic!("bound {bound} does not parse as a number"));
        }
    }

    /// `huge_significant_digit_bounds_export_as_e_notation_within_the_digit_cap`
    /// picked a mantissa (2,072) that happens to round to a trailing zero at
    /// one extra decimal, which masked an off-by-one: the e-notation escape
    /// for over-cap significant-digit bounds passed `sig_digits` itself as
    /// the mantissa's decimal-digit count instead of `sig_digits - 1` (one
    /// digit sits before the decimal point in `m×10^n`), printing one
    /// significant digit too many whenever that extra digit wasn't zero.
    #[test]
    fn huge_significant_digit_bounds_keep_exact_digit_count_in_e_notation() {
        let template = make_template("Jaký počet molekul obsahuje za normálních podmínek chlor?");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(2.0723e26),
            interval_hi: Some(2.0723e26),
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
            mode: TemplateMode::Open,
        }]);

        assert!(
            !output.contains("2,0723e26"),
            "expected 4 significant digits (2,072e26), got a 5th leaking through:\n{output}"
        );
        assert!(
            output.contains("2,072e26"),
            "expected the teacher's 4 significant digits as e-notation, got:\n{output}"
        );
    }

    /// A `;`-assignment formula with no `[symbol]` markers generates
    /// `answers_data: Some(vec![])`. That is a single-answer question: the
    /// closed renderer used to index target 0 and panic (an "export failed"
    /// in the app, a dropped request on the HTTP route), and the open one
    /// wrote a question with no `:n` element at all.
    #[test]
    fn empty_answers_data_exports_as_a_single_answer_question() {
        let template = make_template("Vypočítejte hmotnost.");

        let mut closed = make_closed_variant();
        closed.answers_data = Some(vec![]);
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &closed,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);
        assert!(
            output.contains(" :r1 64,0 g"),
            "missing options in:\n{output}"
        );
        assert!(
            output.contains(":r1 ok 3"),
            "missing evaluation row in:\n{output}"
        );

        let mut open = make_closed_variant();
        open.answers_data = Some(vec![]);
        open.numeric_options = None;
        open.correct_option = None;
        open.interval_lo = Some(45.1);
        open.interval_hi = Some(45.9);
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &open,
            variable_precisions: HashMap::new(),
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 1,
            result_significant_digits: None,
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);
        assert!(
            output.contains(" :n  g\n"),
            "missing input field in:\n{output}"
        );
        assert!(
            output.contains(":n=45,1..45,9 ok 3"),
            "missing evaluation row in:\n{output}"
        );
    }

    /// The generator keeps options distinct on its own grid, which an
    /// absolute SD window refines to 2*sd/(count+1) — finer than the two
    /// decimals an export prints. Five options anchored on sd = 0,02 at 1,0
    /// used to reach the student as `1,00 / 0,99 / 0,99 / 1,01 / 1,01`.
    #[test]
    fn closed_options_widen_precision_until_they_print_distinctly() {
        let template = make_template("Vypočítejte látkové množství.");
        let variant = Variant {
            numeric_options: Some(vec![
                1.0,
                1.006_666_666_666_666_8,
                0.986_666_666_666_666_7,
                0.993_333_333_333_333_4,
                1.013_333_333_333_333_4,
            ]),
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

        // Everything after the ":rN " label, i.e. the value the student reads.
        let mut shown: Vec<&str> = output
            .lines()
            .filter(|l| l.starts_with(" :r"))
            .filter_map(|l| l.trim_start().split_once(' ').map(|(_, value)| value))
            .collect();
        assert_eq!(shown.len(), 5, "expected five option rows in:\n{output}");
        let total = shown.len();
        shown.sort();
        shown.dedup();
        assert_eq!(
            shown.len(),
            total,
            "options must print as distinct values, got:\n{output}"
        );
    }

    /// Reproduces the export IS MU rejected with "V hodnoticí části musí být
    /// aspoň jeden z řádků označen symbolem 'ok'": the row read
    /// `:n="183..185" g 2 ok`, where everything after the answer — the unit
    /// and the points — is swallowed as feedback text, so nothing on it is
    /// marked `ok`. An evaluation row takes the element, then `ok`, then the
    /// points, in that order and nothing else.
    #[test]
    fn open_evaluation_row_marks_ok_before_the_points() {
        let template = make_template("Kolik gramů LiF bude izolováno?");
        let variant = Variant {
            interval_lo: Some(183.0),
            interval_hi: Some(185.0),
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
            result_precision: 0,
            result_significant_digits: None,
            force_scientific: true,
            mode: TemplateMode::Open,
        }]);

        let row = output
            .lines()
            .find(|l| l.starts_with(":n"))
            .expect("evaluation row");
        assert_eq!(row, ":n=183..185 ok 3", "malformed evaluation row: {row}");
        // force_scientific styles the question's own numbers, never this row.
        assert!(
            !row.contains('<') && !row.contains('×') && !row.contains('"'),
            "evaluation row must stay a bare number: {row}"
        );
    }

    /// Reproduces a reported export: a ±30 % tolerance around 0.1137 mol
    /// printed at one decimal collapsed to `"0,1..0,1"`, which accepts only
    /// the rounded midpoint instead of the intended 0.0796–0.1478 band.
    ///
    /// The printed bounds round outward (7e-2 rather than 8e-2 for the lower
    /// one), so the row can never reject an answer the generator, and the
    /// student grading beside it, count as correct. The lower bound prints in
    /// bare `e`-notation on its own: it falls under `SCIENTIFIC_LOWER_THRESHOLD`
    /// (0,1) once rounded outward, while the upper bound does not.
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
            output.contains(":n=7e-2..0,15 ok 3"),
            "interval should keep both bounds distinguishable, got:\n{output}"
        );
        assert!(
            !output.contains("0,1..0,1"),
            "interval collapsed to a single value:\n{output}"
        );
    }

    /// The regression report this fixes: a tiny answer (e.g. ~4×10⁻⁵) used to
    /// export as a wall of leading decimal zeros (`0,00004`) instead of the
    /// compact `4e-5` IS MU still parses as a number.
    #[test]
    fn tiny_interval_bounds_export_as_bare_e_notation() {
        let template = make_template("Vypočítejte koncentraci.");
        let variant = Variant {
            interval_lo: Some(0.000_039),
            interval_hi: Some(0.000_041),
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
            result_significant_digits: Some(1),
            force_scientific: false,
            mode: TemplateMode::Open,
        }]);

        assert!(
            output.contains(":n=3e-5..5e-5 ok 3"),
            "expected bare e-notation for sub-0,1 bounds, got:\n{output}"
        );
        assert!(
            !output.contains("0,00004")
                && !output.contains("0,00003")
                && !output.contains("0,00005"),
            "tiny bound printed as a wall of decimal zeros instead of e-notation:\n{output}"
        );
    }

    /// Now that a tolerance is a true percentage of the answer rather than a
    /// flat ±0,01, an atomic-scale question reaches this row with bounds far
    /// below the printed grid. They must still come out distinct, and wide
    /// enough to hold the band the generator computed: rounding the upper
    /// bound of 4,472e-22 down to 4e-22 would fail a student who answered
    /// 4,4e-22 exactly right.
    #[test]
    fn atomic_scale_interval_bounds_contain_the_generated_tolerance() {
        let template = make_template("Jaká je hmotnost jedné molekuly?");
        let variant = Variant {
            interval_lo: Some(2.408e-22),
            interval_hi: Some(4.472e-22),
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

        let row = output
            .lines()
            .find(|l| l.starts_with(":n="))
            .expect("evaluation row");
        let bounds: Vec<f64> = row
            .trim_start_matches(":n=")
            .split(" ok")
            .next()
            .expect("bounds")
            .split("..")
            .map(|b| b.replace(',', ".").parse::<f64>().expect("numeric bound"))
            .collect();
        assert_eq!(bounds.len(), 2, "malformed row: {row}");
        assert!(bounds[0] < bounds[1], "bounds collapsed in {row}");
        assert!(
            bounds[0] <= 2.408e-22 && bounds[1] >= 4.472e-22,
            "printed bounds clip the generated tolerance: {row}"
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
            .trim_start_matches(":n=")
            .split(" ok")
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

        assert!(output.contains(" :n  g\n"));
        assert!(output.contains(":n=45,1..45,9 ok 3"));
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
                option_sig_digits: None,
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
                option_sig_digits: None,
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

        assert!(
            output.contains(":r1 ok 3"),
            "primary correct must be marked ok"
        );
        assert!(
            output.contains(":r2 ok 3"),
            "alternate must also be marked ok"
        );
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
                option_sig_digits: None,
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
                option_sig_digits: None,
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

        assert!(
            output.contains(":r1 ok 3"),
            "primary correct must be marked ok"
        );
        assert!(
            output.contains(":r2 ok 3"),
            "alternate must also be marked ok"
        );
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
                option_sig_digits: None,
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
                option_sig_digits: None,
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

        // One numbered field per target, each labelled and carrying its unit,
        // then a single row so the points need every part right.
        assert!(
            output.contains(" n =  :n1  mol\n"),
            "missing first labelled field in:\n{output}"
        );
        assert!(
            output.contains(" m =  :n2  g\n"),
            "missing second labelled field in:\n{output}"
        );
        assert!(
            output.contains(":n1=1,8..2,2:n2=3,8..4,2 ok 3"),
            "missing combined evaluation row in:\n{output}"
        );
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

        // `*` always means multiplication, so the asterisk spelling of a
        // hydrate exports as a product; the dot spelling keeps its separator
        // (see the test above).
        assert!(output.contains("FeSO4\u{d7}7H<sub>2</sub>O"));
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

        assert!(output.contains("g×cm<sup>\u{2212}3</sup>"));
        // The unit dot survives; the decimal beside it becomes a comma.
        assert!(output.contains("1,5"));
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

        assert!(output.contains("g×cm<sup>\u{2212}3</sup>"));
        // The unit dot survives; the decimal beside it becomes a comma.
        assert!(output.contains("1,5"));
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
            alternative_significant_digits: None,
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
            output.contains(":n=7,96e-2..0,148 ok 3"),
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

    /// Units with chemical notation (e.g. `cm^-3`, `g*mol^-1`) must be
    /// formatted as HTML in the export, not left as raw `^` or `*`.
    #[test]
    fn closed_options_format_units_as_html() {
        let template = Template {
            id: Uuid::new_v4(),
            question_text: "Vypočítejte hustotu.".to_string(),
            formula: "X * 2".to_string(),
            equation_text: String::new(),
            numeric_answer: None,
            result_unit: "g*cm^-3".to_string(),
            point_value: 3,
            significant_digits: None,
            force_scientific: false,
            decoy_formula: None,
            alternative_formula: None,
            alternative_significant_digits: None,
            created_at: Utc::now(),
        };
        let variant = make_closed_variant();
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

        assert!(
            output.contains("g×cm<sup>\u{2212}3</sup>"),
            "expected HTML-formatted unit, got:\n{output}"
        );
        assert!(
            !output.contains("g*cm^-3"),
            "raw unit notation leaked into export:\n{output}"
        );
    }

    #[test]
    fn open_interval_formats_unit_as_html() {
        let template = Template {
            id: Uuid::new_v4(),
            question_text: "Vypočítejte molární hmotnost.".to_string(),
            formula: "X * 2".to_string(),
            equation_text: String::new(),
            numeric_answer: None,
            result_unit: "g*mol^-1".to_string(),
            point_value: 3,
            significant_digits: None,
            force_scientific: false,
            decoy_formula: None,
            alternative_formula: None,
            alternative_significant_digits: None,
            created_at: Utc::now(),
        };
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(45.1),
            interval_hi: Some(45.9),
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

        // The unit rides with the input field (HTML is fine there); the
        // evaluation row stays a bare number.
        assert!(
            output.contains(" :n  g×mol<sup>\u{2212}1</sup>\n"),
            "expected HTML-formatted unit beside the field, got:\n{output}"
        );
        assert!(
            output.contains(":n=45,1..45,9 ok 3"),
            "evaluation row must carry nothing but the interval, ok and points, got:\n{output}"
        );
        assert!(
            !output.contains("g*mol^-1"),
            "raw unit notation leaked into open interval export:\n{output}"
        );
    }

    /// Regression: when a template sets result_significant_digits, closed-option
    /// values must render with EXACTLY that many significant digits — even when
    /// the engine's significant-figures grid is finer than a legacy SD-based
    /// refinement window. This locks the end-to-end invariant: exported closed
    /// options show the configured sig-fig digit count, no more, no less.
    #[test]
    fn sig_figs_digit_count_survives_sd_fine_grid_in_closed_single() {
        let template = make_template_with_sig("Vypočítejte hmotnost z [[X]] g.", 5);
        let variant = Variant {
            // Options on the 5-sig-fig grid around 23.476 — a legacy finer SD
            // grid could have produced these exact values; the export must
            // still render each with exactly 5 significant digits.
            numeric_options: Some(vec![23.474, 23.475, 23.476, 23.477, 23.478]),
            correct_option: Some(3),
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
            result_significant_digits: Some(5),
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        // Every option must render exactly 5 significant digits in Czech format.
        // 23.474 → 23,474 (5 sig figs), 23.475 → 23,475, etc.
        assert!(
            output.contains(" :r1 23,474 g"),
            "option 1 must render 5 sig figs (23,474), got:\n{output}"
        );
        assert!(
            output.contains(" :r2 23,475 g"),
            "option 2 must render 5 sig figs (23,475), got:\n{output}"
        );
        assert!(
            output.contains(" :r3 23,476 g"),
            "option 3 must render 5 sig figs (23,476), got:\n{output}"
        );
        assert!(
            output.contains(" :r4 23,477 g"),
            "option 4 must render 5 sig figs (23,477), got:\n{output}"
        );
        assert!(
            output.contains(" :r5 23,478 g"),
            "option 5 must render 5 sig figs (23,478), got:\n{output}"
        );
    }

    /// Same invariant for multi-answer closed questions: every option in every
    /// target must render at the configured significant-digit count, even when
    /// the engine's sig-fig grid is finer than a legacy SD-based window.
    #[test]
    fn sig_figs_digit_count_survives_sd_fine_grid_in_closed_multi() {
        let template = make_template_with_sig("Vypočítejte [n mol][m g].", 5);
        let mut variant = make_closed_variant();
        variant.answers_data = Some(vec![
            // Target 1: n (mol) — options on the 5-sig-fig grid
            crate::models::AnswerField {
                symbol: "n".to_string(),
                value: 2.0,
                unit: Some("mol".to_string()),
                numeric_options: Some(vec![1.2345, 1.2346, 1.2347]),
                correct_option: Some(2),
                alternate_option: None,
                interval_lo: None,
                interval_hi: None,
                option_sig_digits: None,
            },
            // Target 2: m (g) — options on the 5-sig-fig grid
            crate::models::AnswerField {
                symbol: "m".to_string(),
                value: 4.0,
                unit: Some("g".to_string()),
                numeric_options: Some(vec![3.4567, 3.4568, 3.4569]),
                correct_option: Some(2),
                alternate_option: None,
                interval_lo: None,
                interval_hi: None,
                option_sig_digits: None,
            },
        ]);
        let precisions = [("X".to_string(), 1)].into();
        let output = write_txt(&[ExportQuestion {
            template: &template,
            variant: &variant,
            variable_precisions: precisions,
            variable_significant_digits: HashMap::new(),
            variable_notations: HashMap::new(),
            result_precision: 2,
            result_significant_digits: Some(5),
            force_scientific: false,
            mode: TemplateMode::Closed,
        }]);

        // Every option in every target must render exactly 5 significant digits.
        // Target 1: 1.2345, 1.2346, 1.2347 (all 5 sig figs)
        assert!(
            output.contains(" :r1 1,2345 mol, 3,4567 g"),
            "row 1 must render 5 sig figs for both targets, got:\n{output}"
        );
        assert!(
            output.contains(" :r2 1,2346 mol, 3,4568 g"),
            "row 2 must render 5 sig figs for both targets, got:\n{output}"
        );
        assert!(
            output.contains(" :r3 1,2347 mol, 3,4569 g"),
            "row 3 must render 5 sig figs for both targets, got:\n{output}"
        );
    }

    #[test]
    fn normalize_decimal_commas_rewrites_prose_decimals() {
        assert_eq!(normalize_decimal_commas("objem 1.25 l"), "objem 1,25 l");
        assert_eq!(normalize_decimal_commas("pH 7.1 a 3.02"), "pH 7,1 a 3,02");
        assert_eq!(normalize_decimal_commas("0.5%"), "0,5%");
    }

    #[test]
    fn normalize_decimal_commas_preserves_hydrates() {
        assert_eq!(normalize_decimal_commas("FeSO4.7H2O"), "FeSO4.7H2O");
        assert_eq!(normalize_decimal_commas("M_FeSO4.7H2O"), "M_FeSO4.7H2O");
        assert_eq!(normalize_decimal_commas("Ca3(PO4)2.4H2O"), "Ca3(PO4)2.4H2O");
    }

    #[test]
    fn normalize_decimal_commas_separates_hydrate_from_decimal() {
        assert_eq!(
            normalize_decimal_commas("CuSO4.5H2O v 0.25 l"),
            "CuSO4.5H2O v 0,25 l"
        );
    }

    #[test]
    fn normalize_decimal_commas_leaves_integers_and_formulas_alone() {
        assert_eq!(normalize_decimal_commas("C6H12O6"), "C6H12O6");
        assert_eq!(normalize_decimal_commas("42 g"), "42 g");
    }

    #[test]
    fn chemical_text_renders_unit_products_as_multiplication() {
        assert_eq!(
            format_chemical_text("g*cm^-3"),
            "g\u{d7}cm<sup>\u{2212}3</sup>"
        );
        assert_eq!(
            format_chemical_text("g\u{b7}cm^-3"),
            "g\u{d7}cm<sup>\u{2212}3</sup>"
        );
        assert_eq!(
            format_chemical_text("g.cm^-3"),
            "g\u{d7}cm<sup>\u{2212}3</sup>"
        );
        assert_eq!(
            format_chemical_text("mol.dm^-3"),
            "mol\u{d7}dm<sup>\u{2212}3</sup>"
        );
        assert_eq!(
            format_chemical_text("mg.ml^-1"),
            "mg\u{d7}ml<sup>\u{2212}1</sup>"
        );
    }

    #[test]
    fn chemical_text_renders_czech_power_of_ten_as_multiplication() {
        assert_eq!(
            format_chemical_text("3,53.10^-4"),
            "3,53\u{d7}10<sup>\u{2212}4</sup>"
        );
        assert_eq!(
            format_chemical_text("1,8*10^-5"),
            "1,8\u{d7}10<sup>\u{2212}5</sup>"
        );
    }

    #[test]
    fn chemical_text_keeps_a_dot_written_hydrate_separator() {
        assert_eq!(format_chemical_text("FeSO4.7H2O"), "FeSO4.7H2O");
        assert_eq!(
            format_chemical_text("FeSO_4.7H_2O"),
            "FeSO<sub>4</sub>.7H<sub>2</sub>O"
        );
    }

    #[test]
    fn chemical_text_renders_an_asterisk_as_multiplication_even_in_a_hydrate() {
        // `*` always means multiplication, whatever it sits between.
        assert_eq!(format_chemical_text("FeSO4*7H2O"), "FeSO4\u{d7}7H2O");
        assert_eq!(
            format_chemical_text("FeSO_4*7H_2O"),
            "FeSO<sub>4</sub>\u{d7}7H<sub>2</sub>O"
        );
        assert_eq!(
            format_chemical_text("NiCl_2*6H_2O"),
            "NiCl<sub>2</sub>\u{d7}6H<sub>2</sub>O"
        );
        assert_eq!(format_chemical_text("2*3"), "2\u{d7}3");
    }

    #[test]
    fn normalize_decimal_commas_is_idempotent_on_a_power_of_ten() {
        // `.10^` is a multiplication separator, not a decimal point. Running
        // twice must not turn `3,53.10^-4` into `3,53,10^-4`.
        let once = normalize_decimal_commas("Ka=3.53.10^-4");
        assert_eq!(once, "Ka=3,53.10^-4");
        assert_eq!(normalize_decimal_commas(&once), once);
        let b = normalize_decimal_commas("1.8.10^-5");
        assert_eq!(b, "1,8.10^-5");
        assert_eq!(normalize_decimal_commas(&b), b);
        // A genuine decimal whose fraction merely starts with "10" still converts.
        assert_eq!(normalize_decimal_commas("2.104 g"), "2,104 g");
        assert_eq!(normalize_decimal_commas("3.10 ml"), "3,10 ml");
    }

    #[test]
    fn chemical_text_leaves_sentence_periods_alone() {
        assert_eq!(
            format_chemical_text("Vypo\u{10d}\u{ed}tejte hmotnost. Jak\u{e1} je"),
            "Vypo\u{10d}\u{ed}tejte hmotnost. Jak\u{e1} je"
        );
        assert_eq!(format_chemical_text("hustota je 2 g."), "hustota je 2 g.");
    }

    /// An ionic charge is a minus too: `SO4^2-` must not export its charge as
    /// a hyphen.
    #[test]
    fn chemical_text_renders_a_charge_with_the_real_minus_sign() {
        assert_eq!(format_chemical_text("SO4^2-"), "SO4<sup>2\u{2212}</sup>");
    }

    /// A negative option value the app itself formatted carries the real
    /// minus sign, not the keyboard hyphen.
    #[test]
    fn negative_option_values_use_the_real_minus_sign() {
        let template = make_template("Vypočítejte entalpii.");
        let variant = Variant {
            numeric_options: Some(vec![-5.2, -3.1, -8.4, -2.0, -6.7]),
            correct_option: Some(1),
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

        assert!(
            output.contains(" :r1 \u{2212}5,2 g"),
            "negative option must use the real minus sign, got:\n{output}"
        );
        assert!(
            !output.contains(" :r1 -5,2"),
            "ASCII hyphen minus leaked into an option, got:\n{output}"
        );
    }

    /// Same for a negative value substituted into the question text.
    #[test]
    fn negative_placeholder_value_uses_the_real_minus_sign() {
        let template = make_template("Teplota klesla na [[t]] \u{b0}C.");
        let variant = make_fixed_variant([("t".to_string(), -5.0), ("X".to_string(), 32.0)]);
        let precisions = [("t".to_string(), 1)].into();
        let output = export_question_text(&template, &variant, precisions);

        assert!(
            output.contains("Teplota klesla na \u{2212}5,0 \u{b0}C."),
            "negative placeholder must use the real minus sign, got:\n{output}"
        );
    }

    /// A hyphen the teacher typed in prose is ambiguous (a range `1-5`, a
    /// compound word), so it is never converted.
    #[test]
    fn prose_hyphens_are_left_alone() {
        let template = make_template("Teplota klesla na -5 \u{b0}C v rozsahu 1-5.");
        let variant = make_closed_variant();
        let output = export_question_text(&template, &variant, HashMap::new());

        assert!(
            output.contains("klesla na -5 \u{b0}C") && output.contains("rozsahu 1-5."),
            "prose hyphens must stay as typed, got:\n{output}"
        );
        assert!(
            !output.contains('\u{2212}'),
            "nothing in this prose should carry the real minus sign:\n{output}"
        );
    }

    /// The `:n` evaluation row is parsed by IS MU as a number, so even a
    /// negative bound keeps the ASCII hyphen there.
    #[test]
    fn negative_interval_bounds_keep_the_ascii_hyphen() {
        let template = make_template("Vypočítejte teplotní rozdíl.");
        let variant = Variant {
            numeric_options: None,
            correct_option: None,
            interval_lo: Some(-5.0),
            interval_hi: Some(-3.0),
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

        let row = output
            .lines()
            .find(|l| l.starts_with(":n="))
            .expect("evaluation row");
        assert!(
            row.contains(":n=-5,0..-3,0 ok 3"),
            "negative bounds must keep the ASCII hyphen, got: {row}"
        );
        assert!(
            !row.contains('\u{2212}'),
            "real minus sign leaked into a machine-parsed row: {row}"
        );
    }
}
