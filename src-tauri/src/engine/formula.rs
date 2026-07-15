use evalexpr::{ContextWithMutableFunctions, ContextWithMutableVariables, HashMapContext, Value};
use std::collections::HashMap;

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
/// - Strip a leading "identifier =" assignment that users often write when
///   entering chemical equations, e.g. "m = n * M".
fn normalize_formula(formula: &str) -> String {
    let mut normalized = formula.trim().replace(',', ".");

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
        let (symbol, next) = parse_element(formula, i).ok_or_else(|| format!("Unexpected character '{}'", c))?;
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

fn resolve_molar_masses(formula: &str) -> String {
    let mut result = String::new();
    let mut i = 0;
    while i < formula.len() {
        if formula[i..].starts_with("M_") {
            let start = i + 2;
            let mut end = start;
            let mut paren_depth = 0;
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
                } else if c == '(' {
                    paren_depth += 1;
                    end += c.len_utf8();
                } else if c == ')' && paren_depth > 0 {
                    paren_depth -= 1;
                    end += c.len_utf8();
                } else {
                    break;
                }
            }
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

fn is_identifier_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Replace the identifier following `M_` when it is a string variable.
/// `M_atom2A` becomes `M_Pb` when `atom2A` sampled "Pb", allowing the molar-mass
/// resolver to compute the atomic weight.
fn substitute_string_variables(
    formula: &str,
    assigned_strings: &HashMap<String, String>,
) -> String {
    if assigned_strings.is_empty() {
        return formula.to_string();
    }

    let mut names: Vec<&str> = assigned_strings.keys().map(|s| s.as_str()).collect();
    names.sort_by_key(|s| std::cmp::Reverse(s.len()));

    let chars: Vec<char> = formula.chars().collect();
    let mut result = String::with_capacity(formula.len());
    let mut i = 0;

    while i < chars.len() {
        if i + 2 <= chars.len() && chars[i] == 'M' && chars[i + 1] == '_' {
            let after_underscore = i + 2;
            let mut matched = false;
            for name in &names {
                let name_chars: Vec<char> = name.chars().collect();
                if after_underscore + name_chars.len() > chars.len() {
                    continue;
                }
                if chars[after_underscore..after_underscore + name_chars.len()] != name_chars[..] {
                    continue;
                }
                let next_pos = after_underscore + name_chars.len();
                let next_ok = next_pos == chars.len() || !is_identifier_char(chars[next_pos]);
                if next_ok {
                    result.push_str("M_");
                    result.push_str(
                        assigned_strings.get(*name).map(|s| s.as_str()).unwrap_or(name),
                    );
                    i = next_pos;
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }

    result
}

/// Evaluate a formula with the given variable and constant values.
/// String variables are not substituted; use [`evaluate_with_strings`] when the
/// formula references string variables (e.g. `M_atom2A`).
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
pub fn evaluate(
    formula: &str,
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
) -> Result<f64, FormulaError> {
    evaluate_with_strings(formula, variables, constants, &HashMap::new())
}

/// Evaluate a formula, substituting sampled string variables before resolving
/// molar masses. Required for formulas like `M_atom2B / M_atom2A` where the
/// element symbols come from string variables.
pub fn evaluate_with_strings(
    formula: &str,
    variables: &HashMap<String, f64>,
    constants: &HashMap<String, f64>,
    assigned_strings: &HashMap<String, String>,
) -> Result<f64, FormulaError> {
    let normalized = normalize_formula(formula);
    if normalized.is_empty() {
        return Err(FormulaError::Empty);
    }

    let with_strings = substitute_string_variables(&normalized, assigned_strings);
    let with_molar_masses = resolve_molar_masses(&with_strings);
    let prepared = substitute_special_constants(&with_molar_masses, constants);
    let context = build_context(variables, constants)?;
    let value =
        evalexpr::eval_with_context(&prepared, &context).map_err(FormulaError::from_evalexpr)?;

    value.as_number().map_err(FormulaError::from_evalexpr)
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
        let v = vars(&[("V2", 10.0), ("V3", 5.0), ("V4", 2.0), ("c3", 1.0), ("w1perc", 20.0), ("rho_r1", 1.1864)]);
        let result = evaluate(
            "rho_r1 * (100/w1perc) * (c3*V4/V3) * (1000/V2) * M_KOH",
            &v,
            &HashMap::new(),
        )
        .unwrap();
        assert!(result > 0.0);
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
    fn equation_formula_uses_rhs() {
        let v = vars(&[("n", 2.0), ("M", 18.0)]);
        let result = evaluate("m = n * M", &v, &HashMap::new()).unwrap();
        assert!((result - 36.0).abs() < 1e-10);
    }

    #[test]
    fn molar_mass_from_string_variable() {
        let mut strings = HashMap::new();
        strings.insert("atom2A".to_string(), "Pb".to_string());
        strings.insert("atom2B".to_string(), "Ag".to_string());
        let result = evaluate_with_strings(
            "M_atom2B / M_atom2A",
            &HashMap::new(),
            &HashMap::new(),
            &strings,
        )
        .unwrap();
        let expected = 107.87 / 207.2;
        assert!((result - expected).abs() < 0.01);
    }

    #[test]
    fn molar_mass_hydrate_in_ratio() {
        let mut vars = HashMap::new();
        vars.insert("ms".to_string(), 10.0);
        vars.insert("mv".to_string(), 90.0);
        let result = evaluate(
            "w = ms * (M_CuSO_4 / M_CuSO_4*5H_2O) / (ms + mv)",
            &vars,
            &HashMap::new(),
        )
        .unwrap();
        assert!(result > 0.06 && result < 0.07);
    }
}
