use evalexpr::{ContextWithMutableFunctions, ContextWithMutableVariables, HashMapContext, Value};
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::models::atomic_weights::ATOMIC_ELEMENTS;

/// Errors that can occur when evaluating a formula.
#[derive(Debug, thiserror::Error, Clone, PartialEq)]
pub enum FormulaError {
    #[error("Failed to parse formula: {0}")]
    Parse(String),
    #[error("Unknown variable or constant: '{0}'")]
    UnknownSymbol(String),
    #[error("Division by zero")]
    DivisionByZero,
    #[error("Numeric error: {0}")]
    Numeric(String),
    #[error("Empty formula")]
    Empty,
}

impl FormulaError {
    /// Convert an `evalexpr::EvalexprError` into a domain-specific error.
    pub fn from_evalexpr(err: evalexpr::EvalexprError) -> Self {
        use evalexpr::EvalexprError::*;
        match err {
            DivisionError { .. } => FormulaError::DivisionByZero,
            VariableIdentifierNotFound(ident) | FunctionIdentifierNotFound(ident) => {
                FormulaError::UnknownSymbol(ident)
            }
            UnmatchedLBrace
            | UnmatchedRBrace
            | UnmatchedDoubleQuote
            | MissingOperatorOutsideOfBrace
            | UnmatchedPartialToken { .. } => FormulaError::Parse(err.to_string()),
            _ => FormulaError::Numeric(err.to_string()),
        }
    }
}

/// Normalize a formula string for evaluation.
/// - Trim whitespace.
/// - Replace Czech decimal commas with dots.
/// - Convert multiplication signs (×, ·) to `*` and Unicode minus (−) / division
///   slash (÷) to their ASCII equivalents.
/// - Strip a leading "identifier =" assignment that users often write when
///   entering chemical equations, e.g. "m = n * M".
/// - Strip explanatory comments after an em dash, e.g. "— (NA = ...")".
fn normalize_formula(formula: &str) -> String {
    let without_comment = formula.split('—').next().unwrap_or(formula).trim();
    let mut normalized = without_comment.replace(',', ".");
    normalized = normalize_operators(&normalized);

    loop {
        let trimmed = normalized.trim();
        if let Some(eq_pos) = trimmed.find('=') {
            let before = trimmed[..eq_pos].trim();
            let after = trimmed[eq_pos + 1..].trim();
            if is_single_identifier(before) && !after.is_empty() {
                normalized = after.to_string();
                continue;
            }
        }
        break;
    }

    normalized
}

/// Replace common Unicode math operators with their ASCII equivalents so that
/// formulas copied from word processors or web pages still evaluate.
fn normalize_operators(formula: &str) -> String {
    formula
        .replace(['×', '·'], "*")
        .replace('−', "-")
        .replace('÷', "/")
}

fn is_single_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Build an evaluation context populated with variables, constants, and helper functions.
fn build_context(
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
) -> Result<HashMapContext, FormulaError> {
    let mut context = HashMapContext::new();

    for (name, value) in variables {
        context
            .set_value(name.clone(), Value::from_float(*value))
            .map_err(FormulaError::from_evalexpr)?;
    }
    for (name, value) in constants {
        context
            .set_value(name.clone(), Value::from_float(*value))
            .map_err(FormulaError::from_evalexpr)?;
    }

    context
        .set_function(
            "sqrt".to_string(),
            evalexpr::Function::new(|arg| {
                let x: f64 = arg.as_number()?;
                Ok(Value::from_float(x.sqrt()))
            }),
        )
        .map_err(FormulaError::from_evalexpr)?;

    context
        .set_function(
            "abs".to_string(),
            evalexpr::Function::new(|arg| {
                let x: f64 = arg.as_number()?;
                Ok(Value::from_float(x.abs()))
            }),
        )
        .map_err(FormulaError::from_evalexpr)?;

    context
        .set_function(
            "round".to_string(),
            evalexpr::Function::new(|arg| {
                let x: f64 = arg.as_number()?;
                Ok(Value::from_float(x.round()))
            }),
        )
        .map_err(FormulaError::from_evalexpr)?;

    context
        .set_function(
            "ln".to_string(),
            evalexpr::Function::new(|arg| {
                let x: f64 = arg.as_number()?;
                if x <= 0.0 {
                    return Err(evalexpr::EvalexprError::CustomMessage(
                        "ln requires a positive argument".to_string(),
                    ));
                }
                Ok(Value::from_float(x.ln()))
            }),
        )
        .map_err(FormulaError::from_evalexpr)?;

    context
        .set_function(
            "log".to_string(),
            evalexpr::Function::new(|arg| {
                let x: f64 = arg.as_number()?;
                if x <= 0.0 {
                    return Err(evalexpr::EvalexprError::CustomMessage(
                        "log requires a positive argument".to_string(),
                    ));
                }
                Ok(Value::from_float(x.log10()))
            }),
        )
        .map_err(FormulaError::from_evalexpr)?;

    Ok(context)
}

fn is_valid_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn substitute_special_constants(formula: &str, constants: &HashMap<String, f64>) -> String {
    let mut special: Vec<(&String, &f64)> = constants
        .iter()
        .filter(|(symbol, _)| !is_valid_identifier(symbol))
        .collect();
    special.sort_by_key(|(symbol, _)| std::cmp::Reverse(symbol.len()));

    let mut result = formula.to_string();
    for (symbol, value) in special {
        result = result.replace(symbol, &value.to_string());
    }
    result
}

fn atomic_weights_map() -> HashMap<String, f64> {
    ATOMIC_ELEMENTS
        .iter()
        .map(|(symbol, _, weight)| (symbol.to_string(), *weight))
        .collect()
}

fn atomic_weight_for_symbol(symbol: &str) -> Option<f64> {
    ATOMIC_ELEMENTS
        .iter()
        .find(|(s, _, _)| *s == symbol)
        .map(|(_, _, weight)| *weight)
}

fn parse_element(formula: &str, start: usize) -> Option<(String, usize)> {
    if start >= formula.len() {
        return None;
    }
    let first = formula[start..].chars().next()?;
    if !first.is_ascii_uppercase() {
        return None;
    }
    let mut end = start + first.len_utf8();
    let mut lowercase_count = 0;
    while end < formula.len() && lowercase_count < 2 {
        let c = formula[end..].chars().next()?;
        if !c.is_ascii_lowercase() {
            break;
        }
        end += c.len_utf8();
        lowercase_count += 1;
    }
    Some((formula[start..end].to_string(), end))
}

fn parse_number(formula: &str, start: usize) -> (u32, usize) {
    let mut end = start;
    while end < formula.len() {
        let Some(c) = formula[end..].chars().next() else {
            break;
        };
        if !c.is_ascii_digit() {
            break;
        }
        end += c.len_utf8();
    }
    if end == start {
        return (1, start);
    }
    let value = formula[start..end].parse().unwrap_or(1);
    (value, end)
}

fn parse_group(formula: &str, start: usize) -> Result<(HashMap<String, f64>, usize), String> {
    let mut counts: HashMap<String, f64> = HashMap::new();
    let mut i = start;
    while i < formula.len() {
        let c = formula[i..].chars().next().unwrap();
        if c == '(' || c == '[' || c == '{' {
            let close = match c {
                '(' => ')',
                '[' => ']',
                '{' => '}',
                _ => unreachable!(),
            };
            let (inner_counts, next) = parse_group(formula, i + c.len_utf8())?;
            if next >= formula.len() || formula[next..].chars().next().unwrap() != close {
                return Err(format!("Missing closing brace '{}'", close));
            }
            i = next + close.len_utf8();
            let (multiplier, next2) = parse_number(formula, i);
            i = next2;
            for (symbol, count) in inner_counts {
                *counts.entry(symbol).or_insert(0.0) += count * f64::from(multiplier);
            }
            continue;
        }
        if c == ')' || c == ']' || c == '}' {
            break;
        }
        if is_hydrate_separator(c) {
            break;
        }
        let (symbol, next) =
            parse_element(formula, i).ok_or_else(|| format!("Unexpected character '{}'", c))?;
        i = next;
        let (count, next2) = parse_number(formula, i);
        i = next2;
        *counts.entry(symbol).or_insert(0.0) += f64::from(count);
    }
    Ok((counts, i))
}

fn is_hydrate_separator(c: char) -> bool {
    c == '.' || c == '*' || c == '·' || c == '∙'
}

fn calculate_molar_mass(formula: &str) -> Option<f64> {
    let weights = atomic_weights_map();
    let (mut counts, mut i) = parse_group(formula, 0).ok()?;
    while i < formula.len() && is_hydrate_separator(formula[i..].chars().next().unwrap()) {
        i += formula[i..].chars().next().unwrap().len_utf8();
        let (multiplier, next) = parse_number(formula, i);
        i = next;
        let (hydrate_counts, next2) = parse_group(formula, i).ok()?;
        i = next2;
        for (symbol, count) in hydrate_counts {
            *counts.entry(symbol).or_insert(0.0) += count * f64::from(multiplier);
        }
    }
    if i < formula.len() {
        return None;
    }
    let mut total = 0.0;
    for (symbol, count) in counts {
        let weight = *weights.get(&symbol)?;
        total += weight * count;
    }
    Some((total * 100.0).round() / 100.0)
}

/// Find the end of a molar-mass reference (`M_...`).
///
/// The reference may contain chemical symbols, digits, subscript underscores,
/// parentheses (for groups) and hydrate separators (`*`, `.`, `·`, `∙`).
/// Parentheses are tracked so that a closing parenthesis belonging to the
/// surrounding expression is not swallowed — e.g. `(M_NiCl2*6H2O)` stops at
/// the outer `)`.
fn molar_mass_ref_end(formula: &str, start: usize) -> usize {
    let mut end = start;
    let mut paren_depth = 0i32;
    while end < formula.len() {
        let c = formula[end..].chars().next().unwrap();
        let is_formula_char = c.is_ascii_uppercase()
            || c.is_ascii_lowercase()
            || c.is_ascii_digit()
            || c == '_'
            || c == '.'
            || c == '*'
            || c == '·'
            || c == '∙';
        if is_formula_char {
            end += c.len_utf8();
            continue;
        }
        if c == '(' {
            paren_depth += 1;
            end += c.len_utf8();
            continue;
        }
        if c == ')' {
            if paren_depth > 0 {
                paren_depth -= 1;
                end += c.len_utf8();
                continue;
            }
            // Unmatched closing paren belongs to the surrounding expression.
            break;
        }
        break;
    }
    end
}

/// Extract molar-mass references (`M_...`) from a formula together with their
/// resolved numeric values. References that cannot be parsed as a valid
/// chemical formula are skipped.
pub fn extract_molar_mass_constants(formula: &str) -> HashMap<String, f64> {
    let mut result = HashMap::new();
    let mut i = 0;
    while i < formula.len() {
        if formula[i..].starts_with("M_") {
            let start = i + 2;
            let end = molar_mass_ref_end(formula, start);
            let formula_part = convert_underscore_hydrates(&formula[start..end]);
            let formula_part = formula_part.replace('_', "");
            if let Some(value) = calculate_molar_mass(&formula_part) {
                result.entry(formula[i..end].to_string()).or_insert(value);
            }
            i = end;
        } else {
            let c = formula[i..].chars().next().unwrap();
            i += c.len_utf8();
        }
    }
    result
}

fn resolve_molar_masses(formula: &str) -> String {
    let mut result = String::new();
    let mut i = 0;
    while i < formula.len() {
        if formula[i..].starts_with("M_") {
            let start = i + 2;
            let end = molar_mass_ref_end(formula, start);
            let formula_part = convert_underscore_hydrates(&formula[start..end]);
            let formula_part = formula_part.replace('_', "");
            match calculate_molar_mass(&formula_part) {
                Some(value) => result.push_str(&value.to_string()),
                None => result.push_str(&formula[i..end]),
            }
            i = end;
        } else {
            let c = formula[i..].chars().next().unwrap();
            result.push(c);
            i += c.len_utf8();
        }
    }
    result
}

fn convert_underscore_hydrates(formula: &str) -> String {
    let mut result = String::new();
    let mut i = 0;
    while i < formula.len() {
        if formula[i..].starts_with('_') {
            let after_underscore = i + 1;
            let (number, next) = parse_number(formula, after_underscore);
            if next > after_underscore {
                if formula[next..].starts_with("H2O") {
                    result.push('.');
                    result.push_str(&number.to_string());
                    result.push_str("H2O");
                    i = next + 3;
                    continue;
                }
                if formula[next..].starts_with("H_2O") {
                    result.push('.');
                    result.push_str(&number.to_string());
                    result.push_str("H2O");
                    i = next + 4;
                    continue;
                }
            }
        }
        let c = formula[i..].chars().next().unwrap();
        result.push(c);
        i += c.len_utf8();
    }
    result
}

/// Evaluate a formula with the given variable and constant values.
///
/// # Example
/// ```
/// use std::collections::HashMap;
/// use biochemcalc_lib::engine::formula::{evaluate, FormulaError};
///
/// let mut vars = HashMap::new();
/// vars.insert("X".to_string(), 10.0);
/// let result = evaluate("X * 2 + sqrt(16)", &vars, &HashMap::new()).unwrap();
/// assert!((result - 24.0).abs() < f64::EPSILON);
/// ```
static MOLAR_MASS_ID_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"M_[A-Za-z][A-Za-z0-9_]*").expect("valid molar-mass regex"));

fn inject_unresolved_molar_masses(formula: &str, context: &mut HashMapContext) {
    for mat in MOLAR_MASS_ID_REGEX.find_iter(formula) {
        let symbol = mat.as_str();
        let formula_part = symbol.strip_prefix("M_").unwrap_or(symbol);
        let formula_part = convert_underscore_hydrates(formula_part);
        let formula_part = formula_part.replace('_', "");
        if let Some(mass) = calculate_molar_mass(&formula_part) {
            let _ = context.set_value(symbol.to_string(), Value::from_float(mass));
        }
    }
}

/// Replace `M_<string_var>` references with the molar mass of the value stored
/// in the string variable. The value may be an element symbol (e.g. `"Na"`) or a
/// molecular formula (e.g. `"CO2"`, `"C2H4"`). Static molar-mass references like
/// `M_Fe` or `M_H2SO4` are left untouched.
fn resolve_dynamic_molar_masses(formula: &str, strings: &HashMap<String, String>) -> String {
    let mut result = String::new();
    let mut i = 0;
    while i < formula.len() {
        if formula[i..].starts_with("M_") {
            let start = i + 2;
            let mut end = start;
            while end < formula.len() {
                let c = formula[end..].chars().next().unwrap();
                if c.is_ascii_uppercase()
                    || c.is_ascii_lowercase()
                    || c.is_ascii_digit()
                    || c == '_'
                {
                    end += c.len_utf8();
                } else {
                    break;
                }
            }
            let var_name = &formula[start..end];
            if let Some(formula_value) = strings.get(var_name) {
                let mass = atomic_weight_for_symbol(formula_value)
                    .or_else(|| calculate_molar_mass(&formula_value.replace('_', "")));
                if let Some(mass) = mass {
                    result.push_str(&mass.to_string());
                    i = end;
                    continue;
                }
            }
            result.push_str(&formula[i..end]);
            i = end;
        } else {
            let c = formula[i..].chars().next().unwrap();
            result.push(c);
            i += c.len_utf8();
        }
    }
    result
}

pub fn evaluate(
    formula: &str,
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
) -> Result<f64, FormulaError> {
    evaluate_with_strings(formula, variables, constants, &HashMap::new())
}

/// Evaluate a formula with numeric variables, constants, string variables, and
/// pre-computed answer values. Answer values are inserted after constants so
/// that intermediate results (e.g. `n` in `m = n * M`) take precedence over
/// constants with the same symbol.
pub fn evaluate_with_answers(
    formula: &str,
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
    strings: &HashMap<String, String>,
    answers: &HashMap<String, f64>,
) -> Result<f64, FormulaError> {
    let normalized = normalize_formula(formula);
    if normalized.is_empty() {
        return Err(FormulaError::Empty);
    }

    let with_dynamic = resolve_dynamic_molar_masses(&normalized, strings);
    let with_molar_masses = resolve_molar_masses(&with_dynamic);
    let prepared = substitute_special_constants(&with_molar_masses, constants);
    let mut context = build_context(variables, constants)?;

    for (name, value) in strings {
        context
            .set_value(name.clone(), Value::String(value.clone()))
            .map_err(FormulaError::from_evalexpr)?;
    }

    for (name, value) in answers {
        context
            .set_value(name.clone(), Value::from_float(*value))
            .map_err(FormulaError::from_evalexpr)?;
    }

    inject_unresolved_molar_masses(&prepared, &mut context);

    let value =
        evalexpr::eval_with_context(&prepared, &context).map_err(FormulaError::from_evalexpr)?;

    value.as_number().map_err(FormulaError::from_evalexpr)
}

/// Evaluate a formula with numeric variables, constants, and string variables.
///
/// String variables are available in the expression context as string values.
/// This is useful when a formula needs to reference symbolic values that were
/// sampled for string-typed template variables.
pub fn evaluate_with_strings(
    formula: &str,
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
    strings: &HashMap<String, String>,
) -> Result<f64, FormulaError> {
    evaluate_with_answers(formula, variables, constants, strings, &HashMap::new())
}

/// One assignment parsed from a semicolon-separated multi-formula string.
#[derive(Debug, Clone, PartialEq)]
pub struct FormulaAssignment {
    pub target: String,
    pub expression: String,
}

/// Parse a formula that may contain several semicolon-separated assignments,
/// e.g. `"n = V / M_H2O; m = n * M_CaSO4_2H2O"`.
/// Each assignment must have the form `target = expression`. A part without an
/// assignment is treated as an expression with an empty target.
pub fn parse_formula_assignments(formula: &str) -> Result<Vec<FormulaAssignment>, FormulaError> {
    let without_comment = formula.split('—').next().unwrap_or(formula).trim();
    if without_comment.is_empty() {
        return Err(FormulaError::Empty);
    }

    let parts: Vec<&str> = without_comment
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut assignments = Vec::with_capacity(parts.len());
    for part in parts {
        let normalized = normalize_operators(&part.replace(',', "."));
        if let Some(eq_pos) = normalized.find('=') {
            let before = normalized[..eq_pos].trim();
            let after = normalized[eq_pos + 1..].trim();
            if is_single_identifier(before) && !after.is_empty() {
                assignments.push(FormulaAssignment {
                    target: before.to_string(),
                    expression: after.to_string(),
                });
                continue;
            }
        }
        assignments.push(FormulaAssignment {
            target: String::new(),
            expression: normalized,
        });
    }

    Ok(assignments)
}

fn expression_identifiers(expression: &str) -> std::collections::HashSet<String> {
    static IDENTIFIER_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"[A-Za-zα-ωφ][A-Za-z0-9_%α-ωφ]*").expect("valid identifier regex")
    });
    IDENTIFIER_RE
        .find_iter(expression)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Evaluate a list of formula assignments in dependency order.
///
/// The assignments are topologically sorted so that an expression can reference
/// the result of a previous assignment (e.g. `m = n * M` after `n = V / M`).
/// Returns a map from assignment target symbol to computed value.
pub fn evaluate_assignments(
    assignments: &[FormulaAssignment],
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
    strings: &HashMap<String, String>,
) -> Result<HashMap<String, f64>, FormulaError> {
    evaluate_assignments_with_answers(assignments, variables, constants, strings, &HashMap::new())
}

/// Same as [`evaluate_assignments`], but seeds the result map with
/// pre-computed `answers` so that assignments inside a decoy/alternace formula
/// can chain off intermediates produced by the main formula (e.g. a decoy
/// `n = n * 2` reuses the `n` already solved by `n = V / M`).
pub fn evaluate_assignments_with_answers(
    assignments: &[FormulaAssignment],
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
    strings: &HashMap<String, String>,
    answers: &HashMap<String, f64>,
) -> Result<HashMap<String, f64>, FormulaError> {
    let mut graph: std::collections::HashMap<usize, Vec<usize>> = HashMap::new();
    let mut in_degree = vec![0; assignments.len()];

    for (i, a) in assignments.iter().enumerate() {
        let ids = expression_identifiers(&a.expression);
        for (j, b) in assignments.iter().enumerate() {
            if i != j && !b.target.is_empty() && ids.contains(&b.target) {
                graph.entry(j).or_default().push(i);
                in_degree[i] += 1;
            }
        }
    }

    let mut queue: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    for (i, &d) in in_degree.iter().enumerate() {
        if d == 0 {
            queue.push_back(i);
        }
    }

    let mut results = answers.clone();
    let mut evaluated_count = 0;
    while let Some(i) = queue.pop_front() {
        evaluated_count += 1;
        let a = &assignments[i];
        let value = evaluate_with_answers(&a.expression, variables, constants, strings, &results)?;
        if !a.target.is_empty() {
            results.insert(a.target.clone(), value);
        }

        if let Some(deps) = graph.get(&i) {
            for &j in deps {
                in_degree[j] -= 1;
                if in_degree[j] == 0 {
                    queue.push_back(j);
                }
            }
        }
    }

    if evaluated_count != assignments.len() {
        return Err(FormulaError::Parse(
            "circular dependency in formula assignments".to_string(),
        ));
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(map: &[(&str, f64)]) -> HashMap<String, f64> {
        map.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn basic_arithmetic() {
        assert_eq!(
            evaluate("2 + 3 * 4", &HashMap::new(), &HashMap::new()).unwrap(),
            14.0
        );
    }

    #[test]
    fn exponentiation_with_caret() {
        let v = vars(&[("pH", 1.0)]);
        assert!((evaluate("10^-pH", &v, &HashMap::new()).unwrap() - 0.1).abs() < 1e-10);
        assert!(
            (evaluate("10^2", &HashMap::new(), &HashMap::new()).unwrap() - 100.0).abs() < 1e-10
        );
    }

    #[test]
    fn variable_substitution() {
        let v = vars(&[("X", 5.0), ("Y", 2.0)]);
        assert!((evaluate("X / Y", &v, &HashMap::new()).unwrap() - 2.5).abs() < 1e-10);
    }

    #[test]
    fn functions() {
        assert!(
            (evaluate("sqrt(16)", &HashMap::new(), &HashMap::new()).unwrap() - 4.0).abs() < 1e-10
        );
        assert!(
            (evaluate("log(100)", &HashMap::new(), &HashMap::new()).unwrap() - 2.0).abs() < 1e-10
        );
        assert!((evaluate("ln(1)", &HashMap::new(), &HashMap::new()).unwrap() - 0.0).abs() < 1e-10);
    }

    #[test]
    fn czech_decimal_comma() {
        assert!(
            (evaluate("3,14 * 2", &HashMap::new(), &HashMap::new()).unwrap() - 6.28).abs() < 1e-10
        );
    }

    #[test]
    fn division_by_zero() {
        assert!(matches!(
            evaluate("1 / 0", &HashMap::new(), &HashMap::new()),
            Err(FormulaError::DivisionByZero)
        ));
    }

    #[test]
    fn unknown_variable() {
        assert!(matches!(
            evaluate("X + 1", &HashMap::new(), &HashMap::new()),
            Err(FormulaError::UnknownSymbol(_))
        ));
    }

    #[test]
    fn molar_mass_koh() {
        let result = evaluate("M_KOH", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 56.11).abs() < 1e-10);
    }

    #[test]
    fn molar_mass_with_underscore_subscripts() {
        let result = evaluate("M_H_2SO_4", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 98.08).abs() < 1e-10);
    }

    #[test]
    fn molar_mass_in_formula() {
        let v = vars(&[
            ("V2", 10.0),
            ("V3", 5.0),
            ("V4", 2.0),
            ("c3", 1.0),
            ("w1perc", 20.0),
            ("rho_r1", 1.1864),
        ]);
        let result = evaluate(
            "rho_r1 * (100/w1perc) * (c3*V4/V3) * (1000/V2) * M_KOH",
            &v,
            &HashMap::new(),
        )
        .unwrap();
        assert!(result > 0.0);
    }

    #[test]
    fn molar_mass_single_element_s() {
        let result = evaluate("M_S", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 32.06).abs() < 1e-10);
    }

    #[test]
    fn extract_molar_mass_constants_finds_fe_and_s() {
        let constants = extract_molar_mass_constants("m1 * M_Fe / M_S");
        assert_eq!(constants.len(), 2);
        assert!((constants["M_Fe"] - 55.85).abs() < 1e-10);
        assert!((constants["M_S"] - 32.06).abs() < 1e-10);
    }

    #[test]
    fn molar_mass_single_element_fe() {
        let result = evaluate("M_Fe", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 55.85).abs() < 1e-10);
    }

    #[test]
    fn dynamic_molar_mass_from_string_variable() {
        let mut strings = HashMap::new();
        strings.insert("atom1".to_string(), "Na".to_string());
        strings.insert("atom2".to_string(), "Cl".to_string());
        let result = evaluate_with_strings(
            "M_atom2 / M_atom1",
            &HashMap::new(),
            &HashMap::new(),
            &strings,
        )
        .unwrap();
        let expected = 35.45 / 22.99;
        assert!((result - expected).abs() < 1e-6);
    }

    #[test]
    fn dynamic_molar_mass_from_string_variable_molecule() {
        let mut strings = HashMap::new();
        strings.insert("plyn".to_string(), "CO2".to_string());
        let result = evaluate_with_strings(
            "(V / 22.4) * M_plyn",
            &[("V".to_string(), 44.8)].into(),
            &HashMap::new(),
            &strings,
        )
        .unwrap();
        let expected = (44.8 / 22.4) * (12.01 + 2.0 * 16.0);
        assert!((result - expected).abs() < 1e-6);
    }

    #[test]
    fn dynamic_molar_mass_ignores_invalid_element() {
        let mut strings = HashMap::new();
        strings.insert("atom1".to_string(), "Xx".to_string());
        let result = evaluate_with_strings("M_atom1", &HashMap::new(), &HashMap::new(), &strings);
        assert!(matches!(result, Err(FormulaError::UnknownSymbol(_))));
    }

    #[test]
    fn dynamic_molar_mass_does_not_break_static_references() {
        let mut strings = HashMap::new();
        strings.insert("atom1".to_string(), "Na".to_string());
        let result =
            evaluate_with_strings("M_atom1 + M_Fe", &HashMap::new(), &HashMap::new(), &strings)
                .unwrap();
        assert!((result - (22.99 + 55.85)).abs() < 1e-6);
    }

    #[test]
    fn molar_mass_ratio_fe_over_s() {
        let mut vars = HashMap::new();
        vars.insert("m1".to_string(), 1.0);
        let mut constants = HashMap::new();
        constants.insert("M_Fe".to_string(), 55.85);
        let result = evaluate("m1 * M_Fe / M_S", &vars, &constants).unwrap();
        assert!((result - 1.742).abs() < 1e-3);
    }

    #[test]
    fn molar_mass_ratio_fe_over_s_with_assignment() {
        let mut vars = HashMap::new();
        vars.insert("m1".to_string(), 1.0);
        let mut constants = HashMap::new();
        constants.insert("M_Fe".to_string(), 55.85);
        let result = evaluate("m2 = m1 * M_Fe / M_S", &vars, &constants).unwrap();
        assert!((result - 1.742).abs() < 1e-3);
    }

    #[test]
    fn molar_mass_ratio_fe_over_s_with_times_sign() {
        let mut vars = HashMap::new();
        vars.insert("m1".to_string(), 1.0);
        let result = evaluate("m2 = m1 × M_Fe / M_S", &vars, &HashMap::new()).unwrap();
        assert!((result - 1.742).abs() < 1e-3);
    }

    #[test]
    fn molar_mass_hydrate_with_dot() {
        let result = evaluate("M_FeSO4.7H2O", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 278.01).abs() < 0.1);
    }

    #[test]
    fn molar_mass_hydrate_with_underscore_notation() {
        let result = evaluate("M_FeSO_4_7H_2O", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 278.01).abs() < 0.1);
    }

    #[test]
    fn molar_mass_hydrate_in_parentheses() {
        let vars = [("ms".to_string(), 267.0), ("w".to_string(), 1.0)].into();
        let result = evaluate(
            "ms * (M_NiCl2/M_NiCl2*6H2O) / w - ms",
            &vars,
            &HashMap::new(),
        )
        .unwrap();
        assert!((result + 121.44).abs() < 0.1);
    }

    #[test]
    fn molar_mass_group_in_parentheses() {
        let result = evaluate("(M_Ca(OH)2)", &HashMap::new(), &HashMap::new()).unwrap();
        assert!((result - 74.09).abs() < 0.1);
    }

    #[test]
    fn equation_formula_uses_rhs() {
        let v = vars(&[("n", 2.0), ("M", 18.0)]);
        let result = evaluate("m = n * M", &v, &HashMap::new()).unwrap();
        assert!((result - 36.0).abs() < 1e-10);
    }

    #[test]
    fn strips_em_dash_comment() {
        let v = vars(&[("V", 22.4)]);
        let mut constants = HashMap::new();
        constants.insert("NA".to_string(), 1.0);
        let result = evaluate(
            "N = (V / 22,4) * NA — (NA = Avogadrova konstanta)",
            &v,
            &constants,
        )
        .unwrap();
        assert!((result - 1.0).abs() < 1e-10);
    }

    #[test]
    fn parse_multi_formula_splits_assignments() {
        let assignments = parse_formula_assignments("n = V / M_H2O; m = n * M_CaSO4_2H2O").unwrap();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].target, "n");
        assert_eq!(assignments[0].expression, "V / M_H2O");
        assert_eq!(assignments[1].target, "m");
        assert_eq!(assignments[1].expression, "n * M_CaSO4_2H2O");
    }

    #[test]
    fn parse_multi_formula_ignores_comment() {
        let assignments = parse_formula_assignments("n = V / M_H2O; m = n * M — komentář").unwrap();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[1].expression, "n * M");
    }

    #[test]
    fn evaluate_assignments_resolves_dependencies() {
        let assignments = parse_formula_assignments("n = V / M; m = n * k").unwrap();
        let variables = vars(&[("V", 10.0)]);
        let constants = vars(&[("M", 2.0), ("k", 3.0)]);
        let results =
            evaluate_assignments(&assignments, &variables, &constants, &HashMap::new()).unwrap();
        assert!((results["n"] - 5.0).abs() < 1e-9);
        assert!((results["m"] - 15.0).abs() < 1e-9);
    }

    #[test]
    fn evaluate_assignments_detects_cycles() {
        let assignments = parse_formula_assignments("a = b + 1; b = a + 1").unwrap();
        assert!(matches!(
            evaluate_assignments(
                &assignments,
                &HashMap::new(),
                &HashMap::new(),
                &HashMap::new()
            ),
            Err(FormulaError::Parse(_))
        ));
    }

    #[test]
    fn unicode_minus_evaluates_as_subtraction() {
        let result = evaluate("a − b", &vars(&[("a", 5.0), ("b", 3.0)]), &HashMap::new()).unwrap();
        assert!((result - 2.0).abs() < 1e-9);
    }

    #[test]
    fn unicode_division_evaluates_as_division() {
        let result = evaluate("a ÷ b", &vars(&[("a", 6.0), ("b", 3.0)]), &HashMap::new()).unwrap();
        assert!((result - 2.0).abs() < 1e-9);
    }

    #[test]
    fn multi_assignment_with_unicode_operators() {
        let assignments = parse_formula_assignments("ms = a × b; mv = a − ms").unwrap();
        let results = evaluate_assignments(
            &assignments,
            &vars(&[("a", 10.0), ("b", 3.0)]),
            &HashMap::new(),
            &HashMap::new(),
        )
        .unwrap();
        assert!((results["ms"] - 30.0).abs() < 1e-9);
        assert!((results["mv"] - -20.0).abs() < 1e-9);
    }

    /// `evaluate_assignments_with_answers` seeds the result map with
    /// pre-computed answer values, so a decoy assignment like `n = n * 2`
    /// can reuse the `n` already solved by the main formula without
    /// re-computing it from scratch.
    #[test]
    fn evaluate_assignments_with_answers_chains_off_precomputed_answers() {
        let assignments = parse_formula_assignments("n = n * 2").unwrap();
        let answers = vars(&[("n", 5.0), ("m", 10.0)]);
        let results = evaluate_assignments_with_answers(
            &assignments,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &answers,
        )
        .unwrap();
        assert!(
            (results["n"] - 10.0).abs() < 1e-9,
            "n should be overwritten to 10"
        );
        assert!(
            (results["m"] - 10.0).abs() < 1e-9,
            "seeded m should still be present unchanged"
        );
    }

    /// A decoy with multiple assignments seeded by the main formula's
    /// answers resolves dependencies between its own parts.
    #[test]
    fn evaluate_assignments_with_answers_resolves_decoy_internal_dependencies() {
        let assignments = parse_formula_assignments("a = n * 2; b = a + m").unwrap();
        let answers = vars(&[("n", 3.0), ("m", 4.0)]);
        let results = evaluate_assignments_with_answers(
            &assignments,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &answers,
        )
        .unwrap();
        assert!((results["a"] - 6.0).abs() < 1e-9);
        assert!((results["b"] - 10.0).abs() < 1e-9);
    }
}
