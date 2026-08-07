use crate::engine::answer_targets::AnswerTarget;
use crate::engine::formula::{
    evaluate_assignments, evaluate_with_strings, parse_formula_assignments, FormulaError,
};
use crate::models::{
    AnswerField, ConstraintType, ResultConstraint, TemplateMode, Variable, VariableType, Variant,
};
use rand::{rngs::StdRng, Rng, RngExt, SeedableRng};
use std::collections::HashMap;
use uuid::Uuid;

/// Maximum attempts to sample a valid variable combination.
const MAX_SAMPLING_ATTEMPTS: usize = 1000;

/// Errors that can occur during variant generation.
#[derive(Debug, thiserror::Error, Clone, PartialEq)]
pub enum GenerationError {
    #[error("Constraint unsatisfiable after {attempts} attempts: {reason}")]
    ConstraintUnsatisfiable { attempts: usize, reason: String },
    #[error("Formula evaluation failed: {0}")]
    Formula(#[from] FormulaError),
    #[error("Missing variable '{0}' required by template")]
    MissingVariable(String),
    #[error("Invalid distractor configuration: {0}")]
    Distractor(String),
}

/// Validate a computed result against a constraint.
pub fn validate_result(result: f64, constraint: &ResultConstraint) -> Result<(), String> {
    match constraint.constraint_type {
        ConstraintType::Range | ConstraintType::Both => {
            if let Some(min) = constraint.min_result {
                if result < min {
                    return Err(format!("result {result} below minimum {min}"));
                }
            }
            if let Some(max) = constraint.max_result {
                if result > max {
                    return Err(format!("result {result} above maximum {max}"));
                }
            }
        }
        ConstraintType::Sd => {}
    }

    // When "both" is selected, the SD is also checked to ensure the open
    // interval (correct ± sd) stays within the allowed numeric range.
    if matches!(
        constraint.constraint_type,
        ConstraintType::Both | ConstraintType::Sd
    ) {
        if let Some(sd) = constraint.sd_allowed {
            let half_width = sd.abs();
            if let Some(min) = constraint.min_result {
                if result - half_width < min {
                    return Err(format!(
                        "open interval [{}, {}] below minimum {}",
                        result - half_width,
                        result + half_width,
                        min
                    ));
                }
            }
            if let Some(max) = constraint.max_result {
                if result + half_width > max {
                    return Err(format!(
                        "open interval [{}, {}] above maximum {}",
                        result - half_width,
                        result + half_width,
                        max
                    ));
                }
            }
        }
    }

    Ok(())
}

/// Sample a value for a variable uniformly within its range, respecting step and precision.
pub fn sample_variable<R: Rng>(variable: &Variable, rng: &mut R) -> f64 {
    let span = variable.max_value - variable.min_value;
    if span <= 0.0 || variable.step <= 0.0 {
        return variable.min_value;
    }

    let steps = (span / variable.step).floor() as i64;
    let step_index: i64 = rng.random_range(0..=steps);
    let raw = variable.min_value + step_index as f64 * variable.step;

    let factor = 10f64.powi(variable.precision as i32);
    (raw * factor).round() / factor
}

/// Sample a string value uniformly from the variable's predefined list.
fn sample_string_variable_with_index<R: Rng>(variable: &Variable, rng: &mut R) -> (String, usize) {
    let values = variable
        .string_values
        .as_ref()
        .expect("string variable must have values");
    let index = rng.random_range(0..values.len());
    (values[index].clone(), index)
}

fn effective_min_for_greater_than(variable: &Variable, target_value: f64) -> Option<f64> {
    if target_value < variable.min_value {
        return Some(variable.min_value);
    }
    let k = ((target_value - variable.min_value) / variable.step).floor() as i64 + 1;
    let value = variable.min_value + k as f64 * variable.step;
    if value > variable.max_value {
        return None;
    }
    Some(value)
}

fn effective_max_for_less_than(variable: &Variable, target_value: f64) -> Option<f64> {
    if target_value > variable.max_value {
        return Some(variable.max_value);
    }
    let k = ((target_value - variable.min_value) / variable.step).ceil() as i64 - 1;
    let value = variable.min_value + k as f64 * variable.step;
    if value < variable.min_value {
        return None;
    }
    Some(value)
}

fn sample_variable_with_bounds<R: Rng>(
    variable: &Variable,
    min_value: f64,
    max_value: f64,
    rng: &mut R,
) -> Option<f64> {
    let span = max_value - min_value;
    if span < -1e-12 || variable.step <= 0.0 {
        return None;
    }
    if span <= 0.0 {
        return Some(min_value);
    }
    let steps = (span / variable.step).floor() as i64;
    let step_index: i64 = rng.random_range(0..=steps);
    let raw = min_value + step_index as f64 * variable.step;
    let factor = 10f64.powi(variable.precision as i32);
    Some((raw * factor).round() / factor)
}

fn sample_variables(
    variables: &[Variable],
    seed: u64,
) -> Option<(HashMap<String, f64>, HashMap<String, String>)> {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut numeric = HashMap::new();
    let mut strings = HashMap::new();

    let symbol_to_index: HashMap<String, usize> = variables
        .iter()
        .enumerate()
        .map(|(i, v)| (v.symbol.clone(), i))
        .collect();

    let mut in_degree = vec![0; variables.len()];
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); variables.len()];

    for (i, v) in variables.iter().enumerate() {
        let target_symbol = match v.greater_than.as_ref().or_else(|| v.less_than.as_ref()) {
            Some(s) => s,
            None => continue,
        };
        let target_index = *symbol_to_index.get(target_symbol)?;
        in_degree[i] += 1;
        dependents[target_index].push(i);
    }

    let mut queue: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    for (i, &d) in in_degree.iter().enumerate() {
        if d == 0 {
            queue.push_back(i);
        }
    }

    let mut order = Vec::with_capacity(variables.len());
    while let Some(i) = queue.pop_front() {
        order.push(i);
        for &dep in &dependents[i] {
            in_degree[dep] -= 1;
            if in_degree[dep] == 0 {
                queue.push_back(dep);
            }
        }
    }

    if order.len() != variables.len() {
        return None;
    }

    for &i in &order {
        let v = &variables[i];
        match v.var_type {
            VariableType::Numeric => {
                let mut min_value = v.min_value;
                let mut max_value = v.max_value;

                if let Some(target_symbol) = &v.greater_than {
                    let target_value = numeric.get(target_symbol)?;
                    min_value = effective_min_for_greater_than(v, *target_value)?;
                }
                if let Some(target_symbol) = &v.less_than {
                    let target_value = numeric.get(target_symbol)?;
                    max_value = effective_max_for_less_than(v, *target_value)?;
                }

                let value = sample_variable_with_bounds(v, min_value, max_value, &mut rng)?;
                numeric.insert(v.symbol.clone(), value);
            }
            VariableType::String => {
                let (value, idx) = sample_string_variable_with_index(v, &mut rng);
                strings.insert(v.symbol.clone(), value);
                if let Some(constants_list) = &v.paired_constants {
                    if let Some(constants) = constants_list.get(idx) {
                        for (sym, &val) in constants {
                            numeric.entry(sym.clone()).or_insert(val);
                        }
                    }
                }
            }
        }
    }

    Some((numeric, strings))
}

/// Compute the correct answer for a template using the assigned variable values,
/// sampled string variable values, and constants.
fn compute_answer(
    formula: &str,
    assigned: &HashMap<String, f64>,
    assigned_strings: &HashMap<String, String>,
    constants: &HashMap<String, f64>,
) -> Result<f64, FormulaError> {
    evaluate_with_strings(formula, assigned, constants, assigned_strings)
}

/// SD fraction for open-answer intervals derived from the selected difficulty.
fn sd_fraction_for_difficulty(difficulty: &str) -> f64 {
    match difficulty {
        "easy" => 0.50,
        "medium" => 0.30,
        "hard" => 0.10,
        _ => 0.30,
    }
}

/// Compute the lower and upper bounds for an open answer.
/// The half-width is driven by difficulty unless the teacher provided an explicit SD.
pub(crate) fn open_interval(
    correct: f64,
    constraint: &ResultConstraint,
    difficulty: &str,
) -> (f64, f64) {
    let half_width = constraint
        .sd_allowed
        .map(|sd| sd.abs())
        .unwrap_or_else(|| (correct.abs() * sd_fraction_for_difficulty(difficulty)).max(0.01));
    (correct - half_width, correct + half_width)
}

const MIN_DISTRACTOR_DEVIATION: f64 = 0.02;

fn max_deviation_for_difficulty(difficulty: &str) -> f64 {
    match difficulty {
        "easy" => 0.50,
        "medium" => 0.30,
        "hard" => 0.10,
        _ => 0.30,
    }
}

fn clamp_option_count(count: u8) -> usize {
    (count as usize).clamp(2, 5)
}

/// Determine a display rounding unit for a numeric answer.
///
/// For values that would collapse to zero when rounded to two decimal places,
/// round to a finer grid based on the selected difficulty. This keeps tiny
/// (e.g. 1e-6) answers readable and, more importantly, prevents distractors
/// for small-but-not-tiny answers (e.g. 0.01–0.20) from rounding back onto the
/// correct answer when the configured difficulty uses a narrow relative band.
fn display_rounding_unit(value: f64, max_deviation: f64) -> f64 {
    let abs_value = value.abs();
    if abs_value == 0.0 {
        return 0.01;
    }

    // For small values the default 0.01 grid is too coarse: a 2–10% relative
    // distractor collapses back to the correct rounded value. Pick a unit fine
    // enough that the maximum deviation leaves room for several distinct
    // rounded distractors on each side of the answer, while preserving the
    // same relative spread defined by the difficulty.
    let max_delta = abs_value * max_deviation;
    let target = max_delta / 2.0;
    if target < 0.01 {
        let order = target.log10().floor();
        let unit = 10f64.powf(order);
        // Avoid absurd numbers of decimal places; chemistry results rarely need
        // sub-nanoscopic precision.
        unit.clamp(1e-9, 0.001)
    } else {
        0.01
    }
}

fn round_to_unit(value: f64, unit: f64) -> f64 {
    if !value.is_finite() || unit == 0.0 {
        return value;
    }
    (value / unit).round() * unit
}

pub(crate) fn generate_numeric_options<R: Rng>(
    correct: f64,
    constraint: &ResultConstraint,
    rng: &mut R,
    difficulty: &str,
    option_count: u8,
) -> Result<(Vec<f64>, u8), GenerationError> {
    let count = clamp_option_count(option_count);
    let max_deviation = max_deviation_for_difficulty(difficulty);

    let mut distractors = Vec::new();
    let mut attempts = 0;
    let rounding_unit = display_rounding_unit(correct, max_deviation);
    let rounded_correct = round_to_unit(correct, rounding_unit);

    while distractors.len() < count - 1 && attempts < 500 {
        attempts += 1;

        let deviation = rng.random_range(MIN_DISTRACTOR_DEVIATION..=max_deviation);
        let direction = if rng.random_bool(0.5) { 1.0 } else { -1.0 };

        // Use the correct answer's magnitude so tiny answers get tiny distractors
        // and don't collapse to nonsensical values like 0.27 or -0.16.
        let reference_magnitude = if correct == 0.0 {
            1.0
        } else {
            correct.abs().max(f64::EPSILON)
        };
        let delta = reference_magnitude * deviation;
        let candidate = correct + direction * delta;

        if !candidate.is_finite() || (candidate - correct).abs() < f64::EPSILON {
            continue;
        }

        let rounded = round_to_unit(candidate, rounding_unit);
        // Use a half-unit tolerance so that values that are exactly one rounding
        // grid step away are accepted despite floating-point representation errors
        // (e.g. 0.24 - 0.23 can be slightly less than 0.01).
        let far_enough =
            (rounded - rounded_correct).abs() > rounding_unit * 0.5 + f64::EPSILON;
        let unique = !distractors
            .iter()
            .any(|d: &f64| (d - rounded).abs() <= rounding_unit * 0.5);
        if validate_result(rounded, constraint).is_ok() && far_enough && unique {
            distractors.push(rounded);
        }
    }

    if distractors.len() < count - 1 {
        return Err(GenerationError::Distractor(format!(
            "only generated {} unique distractors for correct answer {} (constraint: {:?})",
            distractors.len(),
            rounded_correct,
            constraint
        )));
    }

    let correct_position_zero_based: usize = rng.random_range(0..count);
    let correct_position_one_based = correct_position_zero_based as u8 + 1;

    let mut numeric_options = Vec::with_capacity(count);
    let mut distractor_iter = distractors.into_iter();
    for position in 0..count {
        if position == correct_position_zero_based {
            numeric_options.push(rounded_correct);
        } else {
            numeric_options.push(distractor_iter.next().expect("distractors available"));
        }
    }

    Ok((numeric_options, correct_position_one_based))
}

pub fn generate_variant(
    template_id: Uuid,
    formula: &str,
    variables: &[Variable],
    constants: &HashMap<String, f64>,
    constraint: &ResultConstraint,
    mode: TemplateMode,
    base_seed: u64,
    difficulty: &str,
    option_count: u8,
    fixed_values: &HashMap<String, f64>,
) -> Result<Variant, GenerationError> {
    generate_variant_with_targets(
        template_id,
        formula,
        variables,
        constants,
        constraint,
        mode,
        base_seed,
        difficulty,
        option_count,
        fixed_values,
        &[],
    )
}

pub fn generate_variant_with_targets(
    template_id: Uuid,
    formula: &str,
    variables: &[Variable],
    constants: &HashMap<String, f64>,
    constraint: &ResultConstraint,
    mode: TemplateMode,
    base_seed: u64,
    difficulty: &str,
    option_count: u8,
    fixed_values: &HashMap<String, f64>,
    targets: &[AnswerTarget],
) -> Result<Variant, GenerationError> {
    let multi_answer = !targets.is_empty();
    let has_assignments = multi_answer || formula.contains(';');
    let assignments = if has_assignments {
        parse_formula_assignments(formula).map_err(GenerationError::Formula)?
    } else {
        Vec::new()
    };

    let mut seed = base_seed;

    for _attempt in 1..=MAX_SAMPLING_ATTEMPTS {
        let (mut assigned_numeric, assigned_strings) = match sample_variables(variables, seed) {
            Some(result) => result,
            None => {
                seed += 1;
                continue;
            }
        };
        assigned_numeric.extend(fixed_values.iter().map(|(k, v)| (k.clone(), *v)));

        if has_assignments {
            match generate_multi_answer_variant(
                template_id,
                &assignments,
                targets,
                &assigned_numeric,
                &assigned_strings,
                constants,
                constraint,
                mode,
                base_seed,
                difficulty,
                option_count,
            ) {
                Ok(Some(variant)) => return Ok(variant),
                Ok(None) => {
                    seed += 1;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        let correct = compute_answer(formula, &assigned_numeric, &assigned_strings, constants)?;
        if !correct.is_finite() || validate_result(correct, constraint).is_err() {
            seed += 1;
            continue;
        }
        let (numeric_options, correct_option, interval_lo, interval_hi) = match mode {
            TemplateMode::Closed => {
                let mut rng = StdRng::seed_from_u64(seed.wrapping_add(1));
                let (options, position) = generate_numeric_options(
                    correct,
                    constraint,
                    &mut rng,
                    difficulty,
                    option_count,
                )?;
                (Some(options), Some(position), None, None)
            }
            TemplateMode::Open => {
                let (lo, hi) = open_interval(correct, constraint, difficulty);
                (None, None, Some(lo), Some(hi))
            }
        };

        return Ok(Variant::new(
            template_id,
            assigned_numeric,
            assigned_strings,
            correct,
            numeric_options,
            correct_option,
            interval_lo,
            interval_hi,
            base_seed,
        ));
    }

    Err(GenerationError::ConstraintUnsatisfiable {
        attempts: MAX_SAMPLING_ATTEMPTS,
        reason: "could not sample a result satisfying the constraints".to_string(),
    })
}

fn generate_multi_answer_variant(
    template_id: Uuid,
    assignments: &[crate::engine::formula::FormulaAssignment],
    targets: &[AnswerTarget],
    assigned_numeric: &HashMap<String, f64>,
    assigned_strings: &HashMap<String, String>,
    constants: &HashMap<String, f64>,
    constraint: &ResultConstraint,
    mode: TemplateMode,
    base_seed: u64,
    difficulty: &str,
    option_count: u8,
) -> Result<Option<Variant>, GenerationError> {
    let answer_values =
        evaluate_assignments(assignments, assigned_numeric, constants, assigned_strings)
            .map_err(GenerationError::Formula)?;

    let options_seed = base_seed.wrapping_add(1);

    // When no answer targets are specified, treat the last assignment as the
    // primary result so that semicolon-separated formulas still work.
    let mut primary_correct = targets
        .first()
        .and_then(|t| answer_values.get(&t.symbol).copied())
        .or_else(|| {
            assignments
                .iter()
                .filter(|a| !a.target.is_empty())
                .last()
                .and_then(|a| answer_values.get(&a.target).copied())
        })
        .unwrap_or(0.0);
    let mut answers_data = Vec::with_capacity(targets.len());

    for (idx, target) in targets.iter().enumerate() {
        let correct = *answer_values
            .get(&target.symbol)
            .ok_or_else(|| GenerationError::MissingVariable(target.symbol.clone()))?;
        if idx == 0 {
            primary_correct = correct;
        }
        if !correct.is_finite() || validate_result(correct, constraint).is_err() {
            return Ok(None);
        }

        let (numeric_options, correct_option, interval_lo, interval_hi) = match mode {
            TemplateMode::Closed => {
                let mut rng = StdRng::seed_from_u64(options_seed);
                let (options, position) = generate_numeric_options(
                    correct,
                    constraint,
                    &mut rng,
                    difficulty,
                    option_count,
                )?;
                (Some(options), Some(position), None, None)
            }
            TemplateMode::Open => {
                let (lo, hi) = open_interval(correct, constraint, difficulty);
                (None, None, Some(lo), Some(hi))
            }
        };

        answers_data.push(AnswerField {
            symbol: target.symbol.clone(),
            value: correct,
            unit: target.unit.clone(),
            numeric_options,
            correct_option,
            interval_lo,
            interval_hi,
        });
    }

    let (numeric_options, correct_option, interval_lo, interval_hi) = match mode {
        TemplateMode::Closed => {
            let mut rng = StdRng::seed_from_u64(options_seed);
            let (options, position) = generate_numeric_options(
                primary_correct,
                constraint,
                &mut rng,
                difficulty,
                option_count,
            )?;
            (Some(options), Some(position), None, None)
        }
        TemplateMode::Open => {
            let (lo, hi) = open_interval(primary_correct, constraint, difficulty);
            (None, None, Some(lo), Some(hi))
        }
    };

    Ok(Some(Variant {
        id: Uuid::new_v4(),
        template_id,
        assigned_values: assigned_numeric.clone(),
        assigned_strings: assigned_strings.clone(),
        correct_answer: primary_correct,
        numeric_options,
        correct_option,
        interval_lo,
        interval_hi,
        seed: base_seed,
        created_at: chrono::Utc::now(),
        answers_data: Some(answers_data),
    }))
}

pub fn generate_variants(
    template_id: Uuid,
    formula: &str,
    variables: &[Variable],
    constants: &HashMap<String, f64>,
    constraint: &ResultConstraint,
    mode: TemplateMode,
    count: usize,
    base_seed: u64,
    difficulty: &str,
    option_count: u8,
    fixed_values: &HashMap<String, f64>,
) -> Result<Vec<Variant>, GenerationError> {
    generate_variants_with_targets(
        template_id,
        formula,
        variables,
        constants,
        constraint,
        mode,
        count,
        base_seed,
        difficulty,
        option_count,
        fixed_values,
        &[],
    )
}

pub fn generate_variants_with_targets(
    template_id: Uuid,
    formula: &str,
    variables: &[Variable],
    constants: &HashMap<String, f64>,
    constraint: &ResultConstraint,
    mode: TemplateMode,
    count: usize,
    base_seed: u64,
    difficulty: &str,
    option_count: u8,
    fixed_values: &HashMap<String, f64>,
    targets: &[AnswerTarget],
) -> Result<Vec<Variant>, GenerationError> {
    let mut variants = Vec::with_capacity(count);
    for i in 0..count {
        let seed = base_seed.wrapping_add(i as u64);
        let variant = generate_variant_with_targets(
            template_id,
            formula,
            variables,
            constants,
            constraint,
            mode,
            seed,
            difficulty,
            option_count,
            fixed_values,
            targets,
        )?;
        variants.push(variant);
    }
    Ok(variants)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_variable(symbol: &str, min: f64, max: f64, step: f64, precision: u8) -> Variable {
        Variable {
            id: Uuid::new_v4(),
            name: symbol.to_string(),
            symbol: symbol.to_string(),
            var_type: crate::models::VariableType::Numeric,
            min_value: min,
            max_value: max,
            step,
            unit: "g".to_string(),
            precision,
            string_values: None,
            paired_constants: None,
            greater_than: None,
            less_than: None,
            created_at: chrono::Utc::now(),
        }
    }

    fn make_constraint(min: Option<f64>, max: Option<f64>, sd: Option<f64>) -> ResultConstraint {
        make_constraint_typed(min, max, sd, ConstraintType::Range)
    }

    fn make_constraint_typed(
        min: Option<f64>,
        max: Option<f64>,
        sd: Option<f64>,
        constraint_type: ConstraintType,
    ) -> ResultConstraint {
        ResultConstraint {
            id: Uuid::new_v4(),
            template_id: Uuid::new_v4(),
            min_result: min,
            max_result: max,
            sd_allowed: sd,
            constraint_type,
        }
    }

    #[test]
    fn sampler_respects_range_and_step() {
        let v = make_variable("X", 0.0, 10.0, 0.5, 1);
        let mut rng = StdRng::seed_from_u64(42);
        for _ in 0..100 {
            let x = sample_variable(&v, &mut rng);
            assert!(x >= 0.0 && x <= 10.0);
            assert!((x * 10.0).fract() < 1e-9); // multiples of 0.1 due to precision=1
        }
    }

    #[test]
    fn validate_within_range() {
        let c = make_constraint(Some(0.0), Some(100.0), None);
        assert!(validate_result(50.0, &c).is_ok());
        assert!(validate_result(101.0, &c).is_err());
        assert!(validate_result(-1.0, &c).is_err());
    }

    #[test]
    fn generate_closed_variant() {
        let variables = vec![make_variable("X", 1.0, 10.0, 0.1, 1)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let variant = generate_variant(
            Uuid::new_v4(),
            "X * 2",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Closed,
            12345,
            "medium",
            5,
            &HashMap::new(),
        )
        .unwrap();

        assert!(variant.correct_answer >= 2.0 && variant.correct_answer <= 20.0);
        assert_eq!(variant.numeric_options.as_ref().unwrap().len(), 5);
        let correct_pos = variant.correct_option.unwrap() as usize;
        assert_eq!(
            variant.numeric_options.as_ref().unwrap()[correct_pos - 1],
            (variant.correct_answer * 100.0).round() / 100.0
        );
        assert!(variant.interval_lo.is_none());
    }

    #[test]
    fn generate_open_variant() {
        let variables = vec![make_variable("X", 1.0, 10.0, 0.1, 1)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(100.0), Some(0.5));
        let variant = generate_variant(
            Uuid::new_v4(),
            "X * 2",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Open,
            12345,
            "medium",
            5,
            &HashMap::new(),
        )
        .unwrap();

        assert!(variant.interval_lo.is_some());
        assert!(variant.numeric_options.is_none());
    }

    #[test]
    fn generate_variant_respects_greater_than_constraint() {
        let y = make_variable("Y", 1.0, 10.0, 1.0, 0);
        let mut x = make_variable("X", 1.0, 10.0, 1.0, 0);
        x.greater_than = Some("Y".into());
        let variables = vec![y, x];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let variant = generate_variant(
            Uuid::new_v4(),
            "X + Y",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Open,
            1,
            "medium",
            5,
            &HashMap::new(),
        )
        .unwrap();

        let x_val = variant.assigned_values["X"];
        let y_val = variant.assigned_values["Y"];
        assert!(
            x_val > y_val,
            "X ({x_val}) should be greater than Y ({y_val})"
        );
    }

    #[test]
    fn generate_variant_respects_less_than_constraint() {
        let y = make_variable("Y", 1.0, 10.0, 1.0, 0);
        let mut x = make_variable("X", 1.0, 10.0, 1.0, 0);
        x.less_than = Some("Y".into());
        let variables = vec![y, x];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let variant = generate_variant(
            Uuid::new_v4(),
            "X + Y",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Open,
            1,
            "medium",
            5,
            &HashMap::new(),
        )
        .unwrap();

        let x_val = variant.assigned_values["X"];
        let y_val = variant.assigned_values["Y"];
        assert!(x_val < y_val, "X ({x_val}) should be less than Y ({y_val})");
    }

    #[test]
    fn generate_variant_uses_fixed_placeholder_values() {
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let mut fixed_values = HashMap::new();
        fixed_values.insert("wperc".to_string(), 21.1);
        fixed_values.insert("rho_r".to_string(), 1.3083);
        let variant = generate_variant(
            Uuid::new_v4(),
            "(wperc / 100) * rho_r * 1000 / M_H2SO4",
            &[],
            &constants,
            &constraint,
            TemplateMode::Open,
            12345,
            "medium",
            5,
            &fixed_values,
        )
        .unwrap();

        assert!((variant.correct_answer - 2.81).abs() < 0.01);
        assert_eq!(variant.assigned_values["wperc"], 21.1);
        assert_eq!(variant.assigned_values["rho_r"], 1.3083);
    }

    #[test]
    fn generate_variant_resolves_molar_mass_without_constant() {
        let variable = make_variable("m1", 1.0, 10.0, 1.0, 0);
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let variant = generate_variant(
            Uuid::new_v4(),
            "m2 = m1 * M_Fe / M_S",
            &[variable],
            &constants,
            &constraint,
            TemplateMode::Open,
            1,
            "medium",
            5,
            &HashMap::new(),
        )
        .unwrap();

        let m1 = variant.assigned_values["m1"];
        let expected = m1 * 55.85 / 32.06;
        assert!((variant.correct_answer - expected).abs() < 1e-2);
    }

    #[test]
    fn generate_variant_evaluates_negative_ph_exponent() {
        let variable = make_variable("pH", 1.0, 4.0, 0.1, 0);
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(1.0), None);
        let variant = generate_variant(
            Uuid::new_v4(),
            "c = 10^-pH",
            &[variable],
            &constants,
            &constraint,
            TemplateMode::Open,
            1,
            "medium",
            5,
            &HashMap::new(),
        )
        .unwrap();

        let ph = variant.assigned_values["pH"];
        let expected = 10_f64.powf(-ph);
        assert!(
            (variant.correct_answer - expected).abs() < 1e-9,
            "expected {expected}, got {}",
            variant.correct_answer
        );
    }

    #[test]
    fn generate_closed_options_for_tiny_answer_uses_same_magnitude() {
        let constraint = make_constraint(Some(0.0), Some(1.0), None);
        let correct = 1e-6;
        let mut rng = StdRng::seed_from_u64(42);
        let (options, _correct_pos) =
            generate_numeric_options(correct, &constraint, &mut rng, "medium", 5).unwrap();

        assert_eq!(options.len(), 5);
        assert!(options.iter().any(|o| (o - 1e-6).abs() < 1e-12));
        assert!(options.iter().all(|o| *o >= 0.0));
        assert!(options.iter().all(|o| *o < 1e-4));
    }

    #[test]
    fn generate_multi_answer_closed_variant() {
        let variables = vec![make_variable("V", 10.0, 100.0, 1.0, 0)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(10000.0), None);
        let targets = vec![
            crate::engine::answer_targets::AnswerTarget {
                symbol: "n".to_string(),
                unit: Some("mol".to_string()),
            },
            crate::engine::answer_targets::AnswerTarget {
                symbol: "m".to_string(),
                unit: Some("g".to_string()),
            },
        ];
        let variant = generate_variant_with_targets(
            Uuid::new_v4(),
            "n = V / 10; m = n * 5",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Closed,
            12345,
            "medium",
            5,
            &HashMap::new(),
            &targets,
        )
        .unwrap();

        let answers = variant.answers_data.as_ref().unwrap();
        assert_eq!(answers.len(), 2);
        assert_eq!(answers[0].symbol, "n");
        assert_eq!(answers[0].unit, Some("mol".to_string()));
        assert!(answers[0].numeric_options.as_ref().unwrap().len() == 5);
        assert_eq!(answers[1].symbol, "m");
        assert_eq!(answers[1].unit, Some("g".to_string()));
    }

    #[test]
    fn generate_multi_answer_open_variant() {
        let variables = vec![make_variable("V", 10.0, 100.0, 1.0, 0)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(10000.0), Some(0.5));
        let targets = vec![
            crate::engine::answer_targets::AnswerTarget {
                symbol: "n".to_string(),
                unit: Some("mol".to_string()),
            },
            crate::engine::answer_targets::AnswerTarget {
                symbol: "m".to_string(),
                unit: Some("g".to_string()),
            },
        ];
        let variant = generate_variant_with_targets(
            Uuid::new_v4(),
            "n = V / 10; m = n * 5",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Open,
            12345,
            "medium",
            5,
            &HashMap::new(),
            &targets,
        )
        .unwrap();

        let answers = variant.answers_data.as_ref().unwrap();
        assert_eq!(answers.len(), 2);
        assert!(answers[0].interval_lo.is_some());
        assert!(answers[1].interval_lo.is_some());
    }

    #[test]
    fn generate_closed_options_for_small_fraction_with_sd_constraint() {
        let constraint = make_constraint_typed(None, None, Some(0.1), ConstraintType::Sd);
        let correct = 0.01;
        let mut rng = StdRng::seed_from_u64(7);
        let (options, _pos) =
            generate_numeric_options(correct, &constraint, &mut rng, "hard", 5).unwrap();

        assert_eq!(options.len(), 5, "expected 5 options for correct answer {correct}");
        assert!(options.iter().any(|o| (o - correct).abs() < 1e-12));
    }

    #[test]
    fn hard_distractors_stay_unique_for_small_results() {
        let constraint = make_constraint(Some(0.0), Some(1.0), None);
        let values = [0.046, 0.092, 0.138, 0.184, 0.23];

        for &correct in &values {
            for seed in 0..5 {
                let mut rng = StdRng::seed_from_u64(seed);
                let (options, _pos) = generate_numeric_options(
                    correct,
                    &constraint,
                    &mut rng,
                    "hard",
                    5,
                )
                .expect(&format!(
                    "failed to generate distractors for correct={correct}, seed={seed}"
                ));

                assert_eq!(
                    options.len(),
                    5,
                    "wrong option count for correct={correct}, seed={seed}"
                );

                let mut sorted = options.clone();
                sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
                for i in 1..sorted.len() {
                    assert!(
                        (sorted[i] - sorted[i - 1]).abs() > 1e-12,
                        "duplicate options for correct={correct}, seed={seed}: {options:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn generate_variant_uses_assignments_without_targets() {
        let variables = vec![make_variable("V", 10.0, 100.0, 1.0, 0)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(10000.0), None);
        let variant = generate_variant_with_targets(
            Uuid::new_v4(),
            "n = V / 10; m = n * 5",
            &variables,
            &constants,
            &constraint,
            TemplateMode::Open,
            12345,
            "medium",
            5,
            &HashMap::new(),
            &[],
        )
        .unwrap();

        assert!(
            variant.answers_data.as_ref().map(|v| v.is_empty()).unwrap_or(true),
            "expected no answer targets when none are provided"
        );
        let v = variant.assigned_values["V"];
        assert!((variant.correct_answer - (v / 10.0 * 5.0)).abs() < 1e-9);
    }

    /// The tolerance interval for an open answer widens with easier
    /// difficulty: easy ±50 %, medium ±30 %, hard ±10 % of the correct value.
    #[test]
    fn open_interval_width_follows_difficulty() {
        let constraint = ResultConstraint::new(Uuid::new_v4(), None, None, None, ConstraintType::Range);
        let correct = 100.0;

        for (difficulty, expected_half_width) in [("easy", 50.0), ("medium", 30.0), ("hard", 10.0)] {
            let (lo, hi) = open_interval(correct, &constraint, difficulty);
            assert!(
                (lo - (correct - expected_half_width)).abs() < 1e-9,
                "{difficulty}: unexpected lower bound {lo}"
            );
            assert!(
                (hi - (correct + expected_half_width)).abs() < 1e-9,
                "{difficulty}: unexpected upper bound {hi}"
            );
        }
    }

    /// An explicit teacher-set standard deviation overrides the
    /// difficulty-derived width.
    #[test]
    fn open_interval_prefers_explicit_sd_over_difficulty() {
        let constraint = ResultConstraint::new(
            Uuid::new_v4(),
            None,
            None,
            Some(2.5),
            ConstraintType::Sd,
        );
        let (lo, hi) = open_interval(100.0, &constraint, "easy");
        assert!((lo - 97.5).abs() < 1e-9, "unexpected lower bound {lo}");
        assert!((hi - 102.5).abs() < 1e-9, "unexpected upper bound {hi}");
    }
}
