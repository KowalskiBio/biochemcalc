use crate::engine::answer_targets::AnswerTarget;
use crate::engine::formula::{
    evaluate_assignments, evaluate_with_strings, parse_formula_assignments, FormulaError,
};
use crate::models::{
    AnswerField, ConstraintType, ResultConstraint, TemplateDecoy, TemplateMode, Variable,
    VariableType, Variant,
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
/// The half-width is driven by difficulty unless the teacher provided an
/// explicit SD, which always wins. `spread_override` — a per-export custom
/// deviation fraction, e.g. from the export dialog's per-question "Odchylka
/// (%)" field — sits between those two: it beats the difficulty preset but
/// never an explicit SD. Sanitized here too (not just at the call boundary)
/// so a stray non-finite/non-positive value can never produce a nonsensical
/// interval, regardless of caller.
pub(crate) fn open_interval(
    correct: f64,
    constraint: &ResultConstraint,
    difficulty: &str,
    spread_override: Option<f64>,
) -> (f64, f64) {
    let half_width = constraint.sd_allowed.map(|sd| sd.abs()).unwrap_or_else(|| {
        let fraction = spread_override
            .filter(|v| v.is_finite() && *v > 0.0)
            .unwrap_or_else(|| sd_fraction_for_difficulty(difficulty));
        (correct.abs() * fraction).max(0.01)
    });
    (correct - half_width, correct + half_width)
}

const MIN_DISTRACTOR_DEVIATION: f64 = 0.02;

fn max_deviation_for_difficulty(difficulty: &str) -> f64 {
    match difficulty {
        "easy" => 0.70,
        "medium" => 0.50,
        "hard" => 0.30,
        _ => 0.50,
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
        // The floor must be well below the answer's own magnitude, otherwise
        // the correct answer (and every distractor near it) rounds to zero and
        // distractor generation fails with "0 unique distractors". Atomic
        // masses (~1e-24) and similar chemistry values are legitimate here; the
        // frontend renders them in scientific notation regardless of this unit.
        unit.clamp(1e-30, 0.001)
    } else {
        0.01
    }
}

/// Display rounding grid for the generated options.
///
/// When the teacher configured significant digits, the grid must be fine
/// enough to keep them all: the `0.01`-based default would quantize e.g.
/// 23.4759 to 23.47, and the significant-digit formatter both the generate
/// preview and the export apply afterwards can only pad the stump back to
/// "23.470" instead of the correct "23.476". Round to the last significant
/// place instead (5 sig digits at ~23.47 → 0.001 unit). A finer grid is
/// strictly safer for the distractor logic below — `close()`, decoy dedup
/// and the fallback spread all scale with the unit — and it mirrors exactly
/// what `formatSignificantDigits` (JS) / `fmt_significant_cz` (Rust) render,
/// so every view rounds the same server value the same way.
fn display_grid(value: f64, max_deviation: f64, sig_digits: Option<u8>) -> f64 {
    if let Some(n) = sig_digits.filter(|&n| n >= 1) {
        if value.is_finite() && value != 0.0 {
            let order = value.abs().log10().floor() as i32;
            let unit = 10f64.powi(order - (n as i32 - 1));
            // Guard both extremes: degenerate tiny magnitudes (overflowing
            // powi towards zero) and astronomically large values.
            if unit.is_finite() && unit > 0.0 {
                return unit.max(1e-30);
            }
        }
    }
    display_rounding_unit(value, max_deviation)
}

fn round_to_unit(value: f64, unit: f64) -> f64 {
    if !value.is_finite() || unit == 0.0 {
        return value;
    }
    (value / unit).round() * unit
}

/// One decoy's already-evaluated value plus how many option slots it asked
/// for ("počet"), before apportionment scales it down to fit the budget.
#[derive(Clone, Copy)]
pub(crate) struct DecoyAnchor {
    pub value: f64,
    pub requested_count: u8,
}

/// Hamilton / largest-remainder apportionment: scale `requested` counts down
/// to fit exactly within `budget`, preferring earlier list entries when
/// remainders tie (deterministic, matches decoy list `position` order).
/// Never assigns more than an entry's own request. If `budget` already
/// covers the full request, every entry keeps its full request untouched.
fn apportion_largest_remainder(requested: &[usize], budget: usize) -> Vec<usize> {
    let total: usize = requested.iter().sum();
    if total <= budget {
        return requested.to_vec();
    }

    let scale = budget as f64 / total as f64;
    let mut floors: Vec<usize> = requested
        .iter()
        .map(|&r| ((r as f64) * scale).floor() as usize)
        .collect();
    let assigned: usize = floors.iter().sum();
    let leftover = budget - assigned;

    let mut remainders: Vec<(usize, f64)> = requested
        .iter()
        .enumerate()
        .map(|(i, &r)| (i, (r as f64) * scale - floors[i] as f64))
        .collect();
    remainders.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0)) // tie-break: earlier position wins
    });
    for (i, _) in remainders.into_iter().take(leftover) {
        floors[i] += 1;
    }
    floors
}

pub(crate) fn generate_numeric_options<R: Rng>(
    correct: f64,
    decoys: &[DecoyAnchor],
    alternate: Option<f64>,
    constraint: &ResultConstraint,
    rng: &mut R,
    difficulty: &str,
    option_count: u8,
    force_correct_first: bool,
    spread_override: Option<f64>,
    result_significant_digits: Option<u8>,
) -> Result<(Vec<f64>, u8, Option<u8>), GenerationError> {
    let count = clamp_option_count(option_count);
    // A per-export custom deviation (e.g. the export dialog's per-question
    // "Odchylka (%)" field) overrides the difficulty preset when present and
    // sane; sanitized here (not only at the call boundary) so a stray
    // non-finite/non-positive value can never break distractor generation.
    let max_deviation = spread_override
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or_else(|| max_deviation_for_difficulty(difficulty));

    let rounding_unit = display_grid(correct, max_deviation, result_significant_digits);
    let rounded_correct = round_to_unit(correct, rounding_unit);
    let close = |a: f64, b: f64| (a - b).abs() <= rounding_unit * 0.5 * (1.0 + f64::EPSILON);

    // "Alternace": an optional second equation that also evaluates to a
    // correct answer, becoming a second guaranteed-slot option that's also
    // marked correct. Falls back to no alternate (rather than failing
    // generation) exactly like an invalid decoy would, if it doesn't survive
    // the same sanity checks: finite, within the constraint, and far enough
    // from the correct answer once rounded.
    let rounded_alternate: Option<f64> = alternate.and_then(|value| {
        if !value.is_finite() {
            return None;
        }
        let rounded = round_to_unit(value, rounding_unit);
        if validate_result(rounded, constraint).is_err() || close(rounded, rounded_correct) {
            return None;
        }
        Some(rounded)
    });
    let alt_slot = if rounded_alternate.is_some() { 1 } else { 0 };

    struct ValidDecoy {
        rounded: f64,
        requested: usize,
    }

    // A teacher-supplied decoy is only used if it survives the same sanity
    // checks a random distractor would: finite, within the constraint, far
    // enough from the correct answer once rounded, far enough from the
    // alternate answer (if any), and far enough from every earlier
    // already-accepted decoy (a later formula that rounds to the same value
    // is silently dropped). Anything else falls back to normal random
    // distractors so generation never fails because of a bad decoy.
    let mut valid_decoys: Vec<ValidDecoy> = Vec::new();
    for d in decoys {
        if d.requested_count == 0 || !d.value.is_finite() {
            continue;
        }
        let rounded = round_to_unit(d.value, rounding_unit);
        if validate_result(rounded, constraint).is_err() {
            continue;
        }
        if close(rounded, rounded_correct) {
            continue;
        }
        if rounded_alternate.is_some_and(|alt| close(rounded, alt)) {
            continue;
        }
        if valid_decoys.iter().any(|vd| close(rounded, vd.rounded)) {
            continue;
        }
        valid_decoys.push(ValidDecoy {
            rounded,
            requested: d.requested_count as usize,
        });
    }

    // Correct (and the alternate, if valid) each keep at least one slot;
    // decoys share whatever's left of the "wrong" slots, scaled down via
    // largest-remainder apportionment if they ask for more than fits.
    let decoy_budget = count - 1 - alt_slot;
    let requested: Vec<usize> = valid_decoys.iter().map(|vd| vd.requested).collect();
    let decoy_counts = apportion_largest_remainder(&requested, decoy_budget);
    let correct_cluster_size = count - decoy_counts.iter().sum::<usize>() - alt_slot;

    let mut pool: Vec<f64> = Vec::with_capacity(count - 1);

    // Fills `pool` with up to `needed` more values deviated around `anchor`
    // (the same random-deviation logic distractors have always used), unique
    // against the correct answer and against every value already in `pool`
    // — which, by construction, already holds every earlier-committed
    // decoy's exact and perturbed values by the time a later decoy or the
    // correct-answer cluster runs. Returns whether it reached the target
    // count within budget.
    let generate_around = |anchor: f64, needed: usize, pool: &mut Vec<f64>, rng: &mut R| -> bool {
        let start_len = pool.len();
        let mut attempts = 0;

        while pool.len() < start_len + needed && attempts < 500 {
            attempts += 1;

            let deviation = rng.random_range(MIN_DISTRACTOR_DEVIATION..=max_deviation);
            let direction = if rng.random_bool(0.5) { 1.0 } else { -1.0 };

            // Use the anchor's own magnitude so tiny answers get tiny
            // distractors and don't collapse to nonsensical values like
            // 0.27 or -0.16.
            let reference_magnitude = if anchor == 0.0 { 1.0 } else { anchor.abs() };
            let delta = reference_magnitude * deviation;
            let candidate = anchor + direction * delta;

            // Skip candidates that didn't actually move from the anchor in
            // floating-point. Use a relative tolerance so this works for
            // answers of any magnitude (e.g. atomic masses ~1e-24).
            if !candidate.is_finite() || (candidate - anchor).abs() <= anchor.abs() * f64::EPSILON
            {
                continue;
            }

            let rounded = round_to_unit(candidate, rounding_unit);
            // Use a half-unit tolerance so that values that are exactly one
            // rounding grid step away are accepted despite floating-point
            // representation errors (e.g. 0.24 - 0.23 can be slightly less
            // than 0.01). The tolerance must scale with the rounding unit —
            // an absolute f64::EPSILON would dominate for sub-unit answers
            // (e.g. atomic masses ~1e-24) and reject everything.
            let far_enough_from_correct = !close(rounded, rounded_correct)
                && !rounded_alternate.is_some_and(|alt| close(rounded, alt));
            let unique = !pool
                .iter()
                .any(|p: &f64| (p - rounded).abs() <= rounding_unit * 0.5);

            if validate_result(rounded, constraint).is_ok() && far_enough_from_correct && unique {
                pool.push(rounded);
            }
        }

        pool.len() >= start_len + needed
    };

    for (vd, &n) in valid_decoys.iter().zip(decoy_counts.iter()) {
        if n == 0 {
            continue;
        }
        // The literal decoy value fills one slot; only generate more if its
        // apportioned cluster size calls for extra perturbed values.
        pool.push(vd.rounded);
        if n > 1 && !generate_around(vd.rounded, n - 1, &mut pool, rng) {
            return Err(GenerationError::Distractor(format!(
                "only generated {} unique decoy-anchored distractors (needed {}) for decoy {}",
                pool.len().saturating_sub(1),
                n - 1,
                vd.rounded,
            )));
        }
    }

    if correct_cluster_size > 1
        && !generate_around(correct, correct_cluster_size - 1, &mut pool, rng)
    {
        return Err(GenerationError::Distractor(format!(
            "only generated {} unique distractors for correct answer {} (constraint: {:?})",
            pool.len(),
            rounded_correct,
            constraint
        )));
    }

    let has_alternate = rounded_alternate.is_some();

    // When alternace is present the layout is always: a) correct, b) alternate,
    // c..) distractors — regardless of `force_correct_first` (which only
    // governs the no-alternate path). Without alternace, the correct
    // answer's position follows `force_correct_first` as before, so the
    // no-alternate path stays RNG-identical.
    let correct_position_zero_based: usize = if force_correct_first || has_alternate {
        0
    } else {
        rng.random_range(0..count)
    };
    let correct_position_one_based = correct_position_zero_based as u8 + 1;

    // The alternate is always at position b) (index 1) when present. No RNG
    // is consumed, so the no-alternate path stays byte-identical to before.
    let alternate_position_zero_based: Option<usize> = if has_alternate {
        Some(1)
    } else {
        None
    };

    if !valid_decoys.is_empty() {
        // Shuffle so decoy-anchored options don't always land at the lowest
        // non-correct indices. Only done when a decoy is present — the
        // no-decoy path must stay RNG-identical to before this feature.
        for i in (1..pool.len()).rev() {
            let j = rng.random_range(0..=i);
            pool.swap(i, j);
        }
    }

    let mut numeric_options = Vec::with_capacity(count);
    let mut pool_iter = pool.into_iter();
    for position in 0..count {
        if position == correct_position_zero_based {
            numeric_options.push(rounded_correct);
        } else if Some(position) == alternate_position_zero_based {
            numeric_options.push(rounded_alternate.expect("alternate position implies a value"));
        } else {
            numeric_options.push(pool_iter.next().expect("distractors available"));
        }
    }

    Ok((
        numeric_options,
        correct_position_one_based,
        alternate_position_zero_based.map(|p| p as u8 + 1),
    ))
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
    result_significant_digits: Option<u8>,
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
        &[],
        None,
        false,
        None,
        result_significant_digits,
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
    decoys: &[TemplateDecoy],
    alternative_formula: Option<&str>,
    force_correct_first: bool,
    spread_override: Option<f64>,
    result_significant_digits: Option<u8>,
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
                decoys,
                alternative_formula,
                force_correct_first,
                spread_override,
                result_significant_digits,
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
        let (numeric_options, correct_option, alternate_option, interval_lo, interval_hi) =
            match mode {
                TemplateMode::Closed => {
                    let decoy_anchors: Vec<DecoyAnchor> = decoys
                        .iter()
                        .filter_map(|d| {
                            evaluate_with_strings(&d.formula, &assigned_numeric, constants, &assigned_strings)
                                .ok()
                                .map(|value| DecoyAnchor {
                                    value,
                                    requested_count: d.option_count,
                                })
                        })
                        .collect();
                    let alternate_value: Option<f64> = alternative_formula.and_then(|f| {
                        evaluate_with_strings(f, &assigned_numeric, constants, &assigned_strings).ok()
                    });
                    let mut rng = StdRng::seed_from_u64(seed.wrapping_add(1));
                    let (options, position, alt_position) = generate_numeric_options(
                        correct,
                        &decoy_anchors,
                        alternate_value,
                        constraint,
                        &mut rng,
                        difficulty,
                        option_count,
                        force_correct_first,
                        spread_override,
                        result_significant_digits,
                    )?;
                    (Some(options), Some(position), alt_position, None, None)
                }
                TemplateMode::Open => {
                    let (lo, hi) = open_interval(correct, constraint, difficulty, spread_override);
                    (None, None, None, Some(lo), Some(hi))
                }
            };

        let mut variant = Variant::new(
            template_id,
            assigned_numeric,
            assigned_strings,
            correct,
            numeric_options,
            correct_option,
            interval_lo,
            interval_hi,
            base_seed,
        );
        variant.alternate_option = alternate_option;
        return Ok(variant);
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
    decoys: &[TemplateDecoy],
    alternative_formula: Option<&str>,
    force_correct_first: bool,
    spread_override: Option<f64>,
    result_significant_digits: Option<u8>,
) -> Result<Option<Variant>, GenerationError> {
    let answer_values =
        evaluate_assignments(assignments, assigned_numeric, constants, assigned_strings)
            .map_err(GenerationError::Formula)?;

    // Decoys may deliberately reference an intermediate assignment target
    // (e.g. `n` in `n = V / M; m = n * M2`), so they're evaluated with the
    // same answer values available to the assignments themselves.
    //
    // When the question has explicit answer targets (e.g. [n mol][m g]), a
    // decoy with an assignment like `n = n * 2` is routed only to the target
    // it names, so a decoy meant for `n` never leaks into `m`'s option set.
    // A decoy may name multiple targets (`n = n * 2; m = m * 3`) and each
    // routed value claims the decoy's full requested slot count for its
    // target. A bare expression (e.g. `X * 3`) with no `=` falls back to the
    // legacy behavior of offering the same value to every target, where
    // generate_numeric_options's own validation silently drops it from
    // targets whose scale it doesn't fit.
    //
    // When there are no explicit targets (just a semicolon-separated
    // formula), all decoys are evaluated as single values and offered to
    // the primary result, matching the pre-target-routing behavior.
    let mut decoys_by_target: HashMap<String, Vec<DecoyAnchor>> = HashMap::new();
    let mut untargeted_decoys: Vec<DecoyAnchor> = Vec::new();

    if !targets.is_empty() {
        for d in decoys {
            let parsed = match crate::engine::formula::parse_formula_assignments(&d.formula) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let has_target = parsed.iter().any(|a| !a.target.is_empty());
            if has_target {
                let Ok(results) = crate::engine::formula::evaluate_assignments_with_answers(
                    &parsed,
                    assigned_numeric,
                    constants,
                    assigned_strings,
                    &answer_values,
                ) else {
                    continue;
                };
                for a in &parsed {
                    if a.target.is_empty() {
                        continue;
                    }
                    if !targets.iter().any(|t| t.symbol == a.target) {
                        continue;
                    }
                    if let Some(&value) = results.get(a.target.as_str()) {
                        decoys_by_target
                            .entry(a.target.clone())
                            .or_default()
                            .push(DecoyAnchor {
                                value,
                                requested_count: d.option_count,
                            });
                    }
                }
            } else if let Ok(value) = crate::engine::formula::evaluate_with_answers(
                &d.formula,
                assigned_numeric,
                constants,
                assigned_strings,
                &answer_values,
            ) {
                untargeted_decoys.push(DecoyAnchor {
                    value,
                    requested_count: d.option_count,
                });
            }
        }
    } else {
        untargeted_decoys = decoys
            .iter()
            .filter_map(|d| {
                crate::engine::formula::evaluate_with_answers(
                    &d.formula,
                    assigned_numeric,
                    constants,
                    assigned_strings,
                    &answer_values,
                )
                .ok()
                .map(|value| DecoyAnchor {
                    value,
                    requested_count: d.option_count,
                })
            })
            .collect();
    }

    // "Alternace": an optional alternative equation that also evaluates to a
    // correct answer, becoming a second guaranteed-slot option that's also
    // marked correct. Routed per-target the same way as decoys: a formula
    // like `n = V * 2` only provides an alternate for `n`, while a bare
    // expression is offered to every target. An unparseable/failing formula
    // is treated as absent rather than failing generation, same as an
    // invalid decoy.
    let mut alternate_by_target: HashMap<String, f64> = HashMap::new();
    let mut untargeted_alternate: Option<f64> = None;

    if let Some(alt_formula) = alternative_formula {
        if !targets.is_empty() {
            match crate::engine::formula::parse_formula_assignments(alt_formula) {
                Ok(parsed) if parsed.iter().any(|a| !a.target.is_empty()) => {
                    if let Ok(results) =
                        crate::engine::formula::evaluate_assignments_with_answers(
                            &parsed,
                            assigned_numeric,
                            constants,
                            assigned_strings,
                            &answer_values,
                        )
                    {
                        for a in &parsed {
                            if a.target.is_empty() {
                                continue;
                            }
                            if !targets.iter().any(|t| t.symbol == a.target) {
                                continue;
                            }
                            if let Some(&value) = results.get(a.target.as_str()) {
                                alternate_by_target.insert(a.target.clone(), value);
                            }
                        }
                    }
                }
                _ => {
                    untargeted_alternate = crate::engine::formula::evaluate_with_answers(
                        alt_formula,
                        assigned_numeric,
                        constants,
                        assigned_strings,
                        &answer_values,
                    )
                    .ok();
                }
            }
        } else {
            untargeted_alternate = crate::engine::formula::evaluate_with_answers(
                alt_formula,
                assigned_numeric,
                constants,
                assigned_strings,
                &answer_values,
            )
            .ok();
        }
    }

    /// Build the effective decoy anchor list for one target: the target's
    /// own routed decoys followed by the untargeted (bare-expression) ones
    /// that apply to every target.
    fn effective_decoys<'a>(
        target_symbol: &str,
        by_target: &'a HashMap<String, Vec<DecoyAnchor>>,
        untargeted: &'a [DecoyAnchor],
    ) -> Vec<DecoyAnchor> {
        let mut combined: Vec<DecoyAnchor> = Vec::new();
        if let Some(targeted) = by_target.get(target_symbol) {
            combined.extend_from_slice(targeted);
        }
        combined.extend_from_slice(untargeted);
        combined
    }

    /// Resolve the alternate value for one target: a target-specific
    /// alternate wins over the untargeted (bare-expression) one.
    fn effective_alternate(
        target_symbol: &str,
        by_target: &HashMap<String, f64>,
        untargeted: Option<f64>,
    ) -> Option<f64> {
        by_target.get(target_symbol).copied().or(untargeted)
    }

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

        let (numeric_options, correct_option, alternate_option, interval_lo, interval_hi) =
            match mode {
                TemplateMode::Closed => {
                    let mut rng = StdRng::seed_from_u64(options_seed);
                    let target_decoys = effective_decoys(
                        &target.symbol,
                        &decoys_by_target,
                        &untargeted_decoys,
                    );
                    let target_alternate = effective_alternate(
                        &target.symbol,
                        &alternate_by_target,
                        untargeted_alternate,
                    );
                    let (options, position, alt_position) = generate_numeric_options(
                        correct,
                        &target_decoys,
                        target_alternate,
                        constraint,
                        &mut rng,
                        difficulty,
                        option_count,
                        force_correct_first,
                        spread_override,
                        result_significant_digits,
                    )?;
                    (Some(options), Some(position), alt_position, None, None)
                }
                TemplateMode::Open => {
                    let (lo, hi) = open_interval(correct, constraint, difficulty, spread_override);
                    (None, None, None, Some(lo), Some(hi))
                }
            };

        answers_data.push(AnswerField {
            symbol: target.symbol.clone(),
            value: correct,
            unit: target.unit.clone(),
            numeric_options,
            correct_option,
            alternate_option,
            interval_lo,
            interval_hi,
        });
    }

    let (numeric_options, correct_option, alternate_option, interval_lo, interval_hi) = match mode
    {
        TemplateMode::Closed => {
            let mut rng = StdRng::seed_from_u64(options_seed);
            let primary_symbol = targets.first().map(|t| t.symbol.as_str());
            let primary_decoys = match primary_symbol {
                Some(sym) => effective_decoys(sym, &decoys_by_target, &untargeted_decoys),
                None => untargeted_decoys.clone(),
            };
            let primary_alternate = match primary_symbol {
                Some(sym) => effective_alternate(sym, &alternate_by_target, untargeted_alternate),
                None => untargeted_alternate,
            };
            let (options, position, alt_position) = generate_numeric_options(
                primary_correct,
                &primary_decoys,
                primary_alternate,
                constraint,
                &mut rng,
                difficulty,
                option_count,
                force_correct_first,
                spread_override,
                result_significant_digits,
            )?;
            (Some(options), Some(position), alt_position, None, None)
        }
        TemplateMode::Open => {
            let (lo, hi) = open_interval(primary_correct, constraint, difficulty, spread_override);
            (None, None, None, Some(lo), Some(hi))
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
        alternate_option,
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
    result_significant_digits: Option<u8>,
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
        &[],
        None,
        false,
        None,
        result_significant_digits,
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
    decoys: &[TemplateDecoy],
    alternative_formula: Option<&str>,
    force_correct_first: bool,
    spread_override: Option<f64>,
    result_significant_digits: Option<u8>,
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
            decoys,
            alternative_formula,
            force_correct_first,
            spread_override,
            result_significant_digits,
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
            significant_digits: None,
            notation: None,
            created_at: chrono::Utc::now(),
        }
    }

    fn make_constraint(min: Option<f64>, max: Option<f64>, sd: Option<f64>) -> ResultConstraint {
        make_constraint_typed(min, max, sd, ConstraintType::Range)
    }

    fn make_decoy(formula: &str, option_count: u8) -> TemplateDecoy {
        TemplateDecoy {
            id: Uuid::new_v4(),
            template_id: Uuid::new_v4(),
            formula: formula.to_string(),
            option_count,
            position: 0,
        }
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
            None,
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
            None,
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
            None,
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
            None,
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
            None,
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
            None,
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
            None,
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
        let (options, _correct_pos, _alt) =
            generate_numeric_options(correct, &[], None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        assert!(options.iter().any(|o| (o - 1e-6).abs() < 1e-12));
        assert!(options.iter().all(|o| *o >= 0.0));
        assert!(options.iter().all(|o| *o < 1e-4));
    }

    #[test]
    fn generate_closed_options_for_atomic_scale_answer() {
        let constraint = make_constraint(None, None, None);
        let correct = 1.674e-24; // mass of one H atom in grams
        let mut rng = StdRng::seed_from_u64(7);
        let (options, correct_pos, _alt) =
            generate_numeric_options(correct, &[], None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        let correct_option = options[correct_pos as usize - 1];
        // The correct answer is rounded to the display grid (1e-25 here), so
        // the tolerance must accommodate up to half a rounding unit of error.
        assert!(
            (correct_option - correct).abs() < 1e-24,
            "correct option {correct_option} should be close to {correct}"
        );
        let distractors: Vec<f64> = options
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != correct_pos as usize - 1)
            .map(|(_, v)| *v)
            .collect();
        for i in 0..distractors.len() {
            for j in (i + 1)..distractors.len() {
                assert_ne!(
                    distractors[i].to_bits(),
                    distractors[j].to_bits(),
                    "distractors must be unique"
                );
            }
        }
        assert!(
            distractors.iter().all(|d| *d > 0.0),
            "distractors should not collapse to zero"
        );
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
            &[],
            None,
            false,
            None,
            None,
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
            &[],
            None,
            false,
            None,
            None,
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
        let (options, _pos, _alt) =
            generate_numeric_options(correct, &[], None, &constraint, &mut rng, "hard", 5, false, None, None)
                .unwrap();

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
                let (options, _pos, _alt) = generate_numeric_options(
                    correct,
                    &[],
                    None,
                    &constraint,
                    &mut rng,
                    "hard",
                    5,
                    false,
                    None,
                    None,
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
            &[],
            None,
            false,
            None,
            None,
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
            let (lo, hi) = open_interval(correct, &constraint, difficulty, None);
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
        let (lo, hi) = open_interval(100.0, &constraint, "easy", None);
        assert!((lo - 97.5).abs() < 1e-9, "unexpected lower bound {lo}");
        assert!((hi - 102.5).abs() < 1e-9, "unexpected upper bound {hi}");
    }

    #[test]
    fn decoy_value_is_injected_as_one_of_the_options() {
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let correct = 20.0;
        let decoy = 60.0; // far from correct and from any ±30% "medium" distractor
        let mut rng = StdRng::seed_from_u64(1);
        let decoys = [DecoyAnchor {
            value: decoy,
            requested_count: 2,
        }];
        let (options, correct_pos, _alt) =
            generate_numeric_options(correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        assert!(options.iter().any(|o| (o - decoy).abs() < 1e-9));
        assert_eq!(
            options.iter().filter(|o| (**o - correct).abs() < 1e-9).count(),
            1,
            "correct answer must appear exactly once"
        );
        let correct_option = options[correct_pos as usize - 1];
        assert!((correct_option - correct).abs() < 1e-9);
    }

    #[test]
    fn decoy_equal_to_correct_falls_back_to_a_random_distractor() {
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let correct = 20.0;
        let mut rng = StdRng::seed_from_u64(1);
        let decoys = [DecoyAnchor {
            value: correct,
            requested_count: 2,
        }];
        let (options, _pos, _alt) =
            generate_numeric_options(correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        assert_eq!(
            options.iter().filter(|o| (**o - correct).abs() < 1e-9).count(),
            1,
            "decoy colliding with the correct answer must not create a duplicate"
        );
    }

    #[test]
    fn decoy_never_collides_with_a_random_distractor_across_many_seeds() {
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let correct = 20.0;
        let decoy = 25.0;
        let decoys = [DecoyAnchor {
            value: decoy,
            requested_count: 2,
        }];
        for seed in 0..50 {
            let mut rng = StdRng::seed_from_u64(seed);
            let (options, _pos, _alt) = generate_numeric_options(
                correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, None,
            )
            .unwrap();
            let mut sorted = options.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for i in 1..sorted.len() {
                assert!(
                    (sorted[i] - sorted[i - 1]).abs() > 1e-9,
                    "duplicate options for seed={seed}: {options:?}"
                );
            }
        }
    }

    #[test]
    fn alternate_value_is_injected_and_reported_as_a_second_correct_option() {
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let correct = 20.0;
        let alternate = 60.0; // far from correct and from any ±30% "medium" distractor
        let mut rng = StdRng::seed_from_u64(1);
        let (options, correct_pos, alt_pos) = generate_numeric_options(
            correct,
            &[],
            Some(alternate),
            &constraint,
            &mut rng,
            "medium",
            5,
            false,
            None,
            None,
        )
        .unwrap();

        assert_eq!(options.len(), 5);
        // When alternace is present the correct answer is always at a) (1)
        // and the alternate at b) (2), regardless of force_correct_first.
        assert_eq!(correct_pos, 1, "correct must be at a) when alternace is present");
        let alt_pos = alt_pos.expect("valid alternate should get its own option slot");
        assert_eq!(alt_pos, 2, "alternate must be at b) when alternace is present");
        assert!((options[alt_pos as usize - 1] - alternate).abs() < 1e-9);
        assert!((options[correct_pos as usize - 1] - correct).abs() < 1e-9);
    }

    #[test]
    fn alternate_equal_to_correct_falls_back_to_none() {
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let correct = 20.0;
        let mut rng = StdRng::seed_from_u64(1);
        let (options, _pos, alt_pos) = generate_numeric_options(
            correct,
            &[],
            Some(correct),
            &constraint,
            &mut rng,
            "medium",
            5,
            false,
            None,
            None,
        )
        .unwrap();

        assert_eq!(options.len(), 5);
        assert_eq!(alt_pos, None, "an alternate colliding with the correct answer must not be used");
        assert_eq!(
            options.iter().filter(|o| (**o - correct).abs() < 1e-9).count(),
            1,
            "must not create a duplicate of the correct answer"
        );
    }

    #[test]
    fn decoys_never_collide_with_the_alternate_option() {
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let correct = 20.0;
        let alternate = 60.0;
        let decoys = [DecoyAnchor {
            value: alternate,
            requested_count: 2,
        }];
        for seed in 0..50 {
            let mut rng = StdRng::seed_from_u64(seed);
            let (options, correct_pos, alt_pos) = generate_numeric_options(
                correct,
                &decoys,
                Some(alternate),
                &constraint,
                &mut rng,
                "medium",
                5,
                false,
                None,
                None,
            )
            .unwrap();
            // The decoy formula happens to equal the alternate value, so it
            // must be dropped in favor of the (already reserved) alternate
            // slot rather than colliding with it.
            assert_eq!(
                options.iter().filter(|o| (**o - alternate).abs() < 1e-9).count(),
                1,
                "seed={seed}: alternate value must appear exactly once, got {options:?}"
            );
            let alt_pos = alt_pos.expect("alternate should still get its own slot");
            assert_ne!(alt_pos, correct_pos, "seed={seed}");
        }
    }

    #[test]
    fn decoy_formula_is_evaluated_and_injected_into_a_simple_variant() {
        let variables = vec![make_variable("X", 1.0, 10.0, 0.1, 1)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let variant = generate_variant_with_targets(
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
            &[],
            &[make_decoy("X * 3", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let x = variant.assigned_values["X"];
        let decoy_value = x * 3.0;
        let options = variant.numeric_options.as_ref().unwrap();
        assert!(
            options.iter().any(|o| (o - decoy_value).abs() < 1e-6),
            "expected decoy value {decoy_value} among options {options:?}"
        );
    }

    #[test]
    fn decoy_formula_can_chain_off_an_intermediate_assignment() {
        let variables = vec![make_variable("V", 10.0, 100.0, 1.0, 0)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(10000.0), None);
        let targets = vec![crate::engine::answer_targets::AnswerTarget {
            symbol: "m".to_string(),
            unit: Some("g".to_string()),
        }];
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
            &[make_decoy("n * 2", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let v = variant.assigned_values["V"];
        let n = v / 10.0;
        let decoy_value = n * 2.0;
        let options = variant.numeric_options.as_ref().unwrap();
        assert!(
            options.iter().any(|o| (o - decoy_value).abs() < 1e-6),
            "expected decoy value {decoy_value} (from intermediate n) among options {options:?}"
        );
    }

    #[test]
    fn decoy_applies_to_each_target_in_a_multi_answer_variant() {
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
            &[make_decoy("n * 2", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let v = variant.assigned_values["V"];
        let n = v / 10.0;
        let decoy_value = n * 2.0;
        let answers = variant.answers_data.as_ref().unwrap();
        let n_options = answers[0].numeric_options.as_ref().unwrap();
        assert!(
            n_options.iter().any(|o| (o - decoy_value).abs() < 1e-6),
            "expected decoy value {decoy_value} among the first target's own options \
             {n_options:?}, not just the discarded top-level Variant.numeric_options"
        );
    }

    #[test]
    fn alternace_applies_to_each_target_in_a_multi_answer_variant() {
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
            &[],
            Some("n * 2"),
            false,
            None,
            None,
        )
        .unwrap();

        let v = variant.assigned_values["V"];
        let n = v / 10.0;
        let alternate_value = n * 2.0;
        let answers = variant.answers_data.as_ref().unwrap();
        let n_options = answers[0].numeric_options.as_ref().unwrap();
        assert!(
            n_options.iter().any(|o| (o - alternate_value).abs() < 1e-6),
            "expected alternate value {alternate_value} among the first target's own options {n_options:?}"
        );
        let alt_option = answers[0].alternate_option.expect("alternate should get its own slot");
        assert!((n_options[alt_option as usize - 1] - alternate_value).abs() < 1e-6);
    }

    /// A decoy written as an assignment (`n = n * 2`) is routed only to the
    /// answer target it names. The decoy value must appear among `n`'s
    /// options and must NOT leak into `m`'s option set.
    #[test]
    fn targeted_decoy_only_applies_to_its_named_target() {
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
            &[make_decoy("n = n * 2", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let v = variant.assigned_values["V"];
        let n = v / 10.0;
        let decoy_value = n * 2.0;
        let answers = variant.answers_data.as_ref().unwrap();

        let n_options = answers[0].numeric_options.as_ref().unwrap();
        assert!(
            n_options.iter().any(|o| (o - decoy_value).abs() < 1e-6),
            "expected decoy value {decoy_value} among n's options {n_options:?}"
        );

        let m_options = answers[1].numeric_options.as_ref().unwrap();
        assert!(
            !m_options.iter().any(|o| (o - decoy_value).abs() < 1e-6),
            "decoy meant for n must not leak into m's options {m_options:?}"
        );
    }

    /// A single decoy formula with multiple assignments (`n = n * 2; m = m * 3`)
    /// routes each computed value to its respective answer target.
    #[test]
    fn multi_target_decoy_routes_each_value_to_its_target() {
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
            &[make_decoy("n = n * 2; m = m * 3", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let v = variant.assigned_values["V"];
        let n = v / 10.0;
        let m = n * 5.0;
        let n_decoy = n * 2.0;
        let m_decoy = m * 3.0;
        let answers = variant.answers_data.as_ref().unwrap();

        let n_options = answers[0].numeric_options.as_ref().unwrap();
        assert!(
            n_options.iter().any(|o| (o - n_decoy).abs() < 1e-6),
            "expected n's decoy value {n_decoy} among n's options {n_options:?}"
        );

        let m_options = answers[1].numeric_options.as_ref().unwrap();
        assert!(
            m_options.iter().any(|o| (o - m_decoy).abs() < 1e-6),
            "expected m's decoy value {m_decoy} among m's options {m_options:?}"
        );
        assert!(
            !m_options.iter().any(|o| (o - n_decoy).abs() < 1e-6),
            "n's decoy value must not appear in m's options {m_options:?}"
        );
    }

    /// An alternace written as an assignment (`n = n * 2`) is routed only to
    /// the answer target it names: `n` gets an alternate option, `m` does not.
    #[test]
    fn targeted_alternace_only_applies_to_its_named_target() {
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
            &[],
            Some("n = n * 2"),
            false,
            None,
            None,
        )
        .unwrap();

        let v = variant.assigned_values["V"];
        let n = v / 10.0;
        let alternate_value = n * 2.0;
        let answers = variant.answers_data.as_ref().unwrap();

        let n_options = answers[0].numeric_options.as_ref().unwrap();
        assert!(
            n_options.iter().any(|o| (o - alternate_value).abs() < 1e-6),
            "expected alternate value {alternate_value} among n's options {n_options:?}"
        );
        let alt_option = answers[0].alternate_option.expect("n should get an alternate slot");
        assert!((n_options[alt_option as usize - 1] - alternate_value).abs() < 1e-6);

        assert!(
            answers[1].alternate_option.is_none(),
            "m must not get an alternate option when the alternace targets n"
        );
    }

    /// A decoy whose assignment target doesn't match any answer target
    /// (e.g. `x = n * 2` when targets are `n` and `m`) is silently dropped
    /// rather than failing generation.
    #[test]
    fn decoy_targeting_non_answer_symbol_is_silently_dropped() {
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
            &[make_decoy("x = n * 2", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let answers = variant.answers_data.as_ref().unwrap();
        for (i, answer) in answers.iter().enumerate() {
            let options = answer.numeric_options.as_ref().unwrap();
            assert_eq!(
                options.len(),
                5,
                "target {} should still get 5 options",
                i
            );
        }
    }

    #[test]
    fn invalid_decoy_formula_falls_back_gracefully_without_failing_generation() {
        let variables = vec![make_variable("X", 1.0, 10.0, 0.1, 1)];
        let constants = HashMap::new();
        let constraint = make_constraint(Some(0.0), Some(1000.0), None);
        let variant = generate_variant_with_targets(
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
            &[],
            &[make_decoy("this is not a valid formula (((", 2)],
            None,
            false,
            None,
            None,
        )
        .unwrap();

        let options = variant.numeric_options.as_ref().unwrap();
        assert_eq!(options.len(), 5);
        let mut sorted = options.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for i in 1..sorted.len() {
            assert!(
                (sorted[i] - sorted[i - 1]).abs() > 1e-9,
                "options must stay unique even when the decoy formula is invalid: {options:?}"
            );
        }
    }

    /// With no decoy configured, generation for a fixed seed must stay
    /// stable — this pins the exact output so a future change to the
    /// decoy/force-first machinery can't silently perturb the no-decoy path.
    /// (The literal below was recomputed after widening the "medium"
    /// difficulty spread from ±30% to ±50%; it isn't meant to survive a
    /// deliberate difficulty-percentage change like that one.)
    #[test]
    fn no_decoy_produces_identical_options_for_a_fixed_seed() {
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
            None,
        )
        .unwrap();

        let options = variant.numeric_options.as_ref().unwrap();
        assert_eq!(
            options,
            &vec![3.85, 7.82, 4.19, 7.4, 4.63],
            "no-decoy option generation for a fixed seed changed unexpectedly"
        );
    }

    #[test]
    fn apportion_largest_remainder_scales_down_when_oversubscribed() {
        // The user's own worked example: two decoys each requesting 2,
        // budget 3 — the first-listed decoy wins the tie-broken extra slot.
        assert_eq!(apportion_largest_remainder(&[2, 2], 3), vec![2, 1]);
        // Exact fit: nothing needs to be scaled.
        assert_eq!(apportion_largest_remainder(&[1, 2], 3), vec![1, 2]);
        // Tie-break prefers the earlier entry.
        assert_eq!(apportion_largest_remainder(&[1, 1, 1], 2), vec![1, 1, 0]);
        // Nothing requested, nothing assigned.
        assert_eq!(apportion_largest_remainder(&[0, 0], 3), vec![0, 0]);
    }

    /// Each decoy's cluster is one exact value plus (počet - 1) perturbed
    /// distractors around it; with no oversubscription every decoy keeps its
    /// full requested count and the correct answer gets whatever's left.
    #[test]
    fn multi_decoy_clusters_each_get_one_exact_value_plus_requested_perturbations() {
        let constraint = make_constraint(Some(0.0), Some(10_000_000.0), None);
        let correct = 10.0;
        // Each anchor sits far enough from the others that "medium" (±30%)
        // deviation ranges around one anchor never overlap another anchor's
        // band, so cluster membership is unambiguous.
        let decoy_a = 1_000.0;
        let decoy_b = 100_000.0;
        let band = |anchor: f64| (anchor * 0.7, anchor * 1.3);
        let (correct_lo, correct_hi) = band(correct);
        let (a_lo, a_hi) = band(decoy_a);
        let (b_lo, b_hi) = band(decoy_b);

        let decoys = [
            DecoyAnchor {
                value: decoy_a,
                requested_count: 1,
            },
            DecoyAnchor {
                value: decoy_b,
                requested_count: 1,
            },
        ];
        let mut rng = StdRng::seed_from_u64(7);
        let (options, _pos, _alt) =
            generate_numeric_options(correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        let in_band = |lo: f64, hi: f64| options.iter().filter(|o| **o >= lo && **o <= hi).count();
        assert_eq!(
            in_band(a_lo, a_hi),
            1,
            "decoy A (počet=1) should contribute exactly its own value: {options:?}"
        );
        assert_eq!(
            in_band(b_lo, b_hi),
            1,
            "decoy B (počet=1) should contribute exactly its own value: {options:?}"
        );
        assert_eq!(
            in_band(correct_lo, correct_hi),
            3,
            "correct cluster should get the remaining 3 slots (5 - 1 - 1): {options:?}"
        );
    }

    /// The user's own worked example: option_count=4, two decoys each
    /// requesting počet=2 (sum=4, which would leave 0 for the correct
    /// answer) — apportionment must still reserve exactly 1 slot for the
    /// correct answer and scale the decoys down to share the remaining 3
    /// (2/1, first-listed decoy keeps its full request).
    #[test]
    fn multi_decoy_apportionment_reproduces_worked_example() {
        let constraint = make_constraint(Some(0.0), Some(10_000_000.0), None);
        let correct = 10.0;
        let decoy_a = 1_000.0;
        let decoy_b = 100_000.0;
        let band = |anchor: f64| (anchor * 0.7, anchor * 1.3);
        let (correct_lo, correct_hi) = band(correct);
        let (a_lo, a_hi) = band(decoy_a);
        let (b_lo, b_hi) = band(decoy_b);

        let decoys = [
            DecoyAnchor {
                value: decoy_a,
                requested_count: 2,
            },
            DecoyAnchor {
                value: decoy_b,
                requested_count: 2,
            },
        ];
        let mut rng = StdRng::seed_from_u64(11);
        let (options, _pos, _alt) =
            generate_numeric_options(correct, &decoys, None, &constraint, &mut rng, "medium", 4, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 4);
        let in_band = |lo: f64, hi: f64| options.iter().filter(|o| **o >= lo && **o <= hi).count();
        assert_eq!(
            in_band(correct_lo, correct_hi),
            1,
            "correct must always keep exactly 1 slot: {options:?}"
        );
        assert_eq!(
            in_band(a_lo, a_hi),
            2,
            "first-listed decoy keeps its full počet=2 request: {options:?}"
        );
        assert_eq!(
            in_band(b_lo, b_hi),
            1,
            "second decoy is scaled down to 1: {options:?}"
        );
    }

    #[test]
    fn invalid_decoy_is_excluded_and_its_slots_flow_to_the_correct_answer() {
        let constraint = make_constraint(Some(0.0), Some(10_000_000.0), None);
        let correct = 10.0;
        let valid_decoy = 1_000.0;
        let decoys = [
            DecoyAnchor {
                value: f64::NAN,
                requested_count: 2,
            },
            DecoyAnchor {
                value: valid_decoy,
                requested_count: 1,
            },
        ];
        let mut rng = StdRng::seed_from_u64(3);
        let (options, _pos, _alt) =
            generate_numeric_options(correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        let band = |anchor: f64| (anchor * 0.7, anchor * 1.3);
        let (v_lo, v_hi) = band(valid_decoy);
        let (c_lo, c_hi) = band(correct);
        let valid_decoy_slots = options.iter().filter(|o| **o >= v_lo && **o <= v_hi).count();
        let correct_slots = options.iter().filter(|o| **o >= c_lo && **o <= c_hi).count();
        assert_eq!(
            valid_decoy_slots, 1,
            "the valid decoy keeps exactly its own requested count: {options:?}"
        );
        assert_eq!(
            correct_slots, 4,
            "the invalid decoy's 2 requested slots flow to the correct answer (1 exact + 3 perturbed): {options:?}"
        );
    }

    #[test]
    fn two_decoys_colliding_with_each_other_after_rounding_keep_only_the_earlier_one() {
        let constraint = make_constraint(Some(0.0), Some(10_000_000.0), None);
        let correct = 10.0;
        let decoy_value = 1_000.0;
        let decoys = [
            DecoyAnchor {
                value: decoy_value,
                requested_count: 2,
            },
            DecoyAnchor {
                value: decoy_value,
                requested_count: 2,
            },
        ];
        let mut rng = StdRng::seed_from_u64(5);
        let (options, _pos, _alt) =
            generate_numeric_options(correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, None)
                .unwrap();

        assert_eq!(options.len(), 5);
        let band = |anchor: f64| (anchor * 0.7, anchor * 1.3);
        let (d_lo, d_hi) = band(decoy_value);
        let decoy_slots = options.iter().filter(|o| **o >= d_lo && **o <= d_hi).count();
        assert_eq!(
            decoy_slots, 2,
            "only the earlier-listed decoy survives, keeping its full počet=2: {options:?}"
        );
        assert!(options.iter().any(|o| (o - decoy_value).abs() < 1e-9));
    }

    #[test]
    fn force_correct_first_places_answer_at_index_zero() {
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let correct = 20.0;
        for seed in 0..20 {
            let mut rng = StdRng::seed_from_u64(seed);
            let (_options, position, _alt) =
                generate_numeric_options(correct, &[], None, &constraint, &mut rng, "medium", 5, true, None, None)
                    .unwrap();
            assert_eq!(
                position, 1,
                "force_correct_first must always place the correct answer at position 1, seed={seed}"
            );
        }
    }

    /// The display grid must never be coarser than the configured significant
    /// digits — otherwise the correct option is pre-rounded (e.g. 23.4759
    /// onto the 0.01 grid) and the significant-digit formatter used by both
    /// the generate preview and the export can only pad the stump back,
    /// showing "23.470" instead of the expected "23.476".
    #[test]
    fn display_grid_keeps_all_significant_digits() {
        // 5 significant digits at ~23.47 → a 0.001 grid, not the default 0.01.
        assert!((display_grid(23.4759, 0.5, Some(5)) - 0.001).abs() < 1e-12);
        // 2 significant digits at ~111554 → a 10^4 grid (formats as 110000).
        assert!((display_grid(111554.0, 0.5, Some(2)) - 1e4).abs() < 1e-9);
        // Without significant digits the deviation-driven grid is unchanged.
        assert!((display_grid(23.4759, 0.5, None) - 0.01).abs() < 1e-12);
        // Degenerate inputs fall back to the default grid: a zero value or
        // a zero significant-digit count.
        assert!((display_grid(0.0, 0.5, Some(5)) - 0.01).abs() < 1e-12);
        assert!((display_grid(23.4759, 0.5, Some(0)) - 0.01).abs() < 1e-12);
        // Tiny magnitudes stay protected by the 1e-30 floor.
        assert!((display_grid(1.67e-27, 0.5, Some(4)) - 1e-30).abs() < 1e-42);
    }

    /// End-to-end for the reported bug: with 5 significant digits configured,
    /// the stored correct option must keep all of them (23.476), so every
    /// view that formats it with significant digits agrees with the
    /// per-question popup.
    #[test]
    fn significant_digits_grid_preserves_the_correct_option() {
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let correct = 23.4759;
        for seed in 0..20 {
            let mut rng = StdRng::seed_from_u64(seed);
            let (options, position, _alt) = generate_numeric_options(
                correct, &[], None, &constraint, &mut rng, "medium", 5, true, None, Some(5),
            )
            .unwrap();
            let stored_correct = options[(position - 1) as usize];
            assert!(
                (stored_correct - 23.476).abs() < 1e-9,
                "correct option must round to the last significant place, got {stored_correct}"
            );
            let unique: std::collections::HashSet<_> = options
                .iter()
                .map(|o| (o * 1000.0).round() as i64)
                .collect();
            assert_eq!(
                unique.len(),
                options.len(),
                "options must stay distinct on the 0.001 grid: {options:?}"
            );
        }
    }

    /// Decoy acceptance semantics must survive the finer grid: a decoy
    /// differing in the last significant place is kept, while one that
    /// rounds onto the correct answer is dropped.
    #[test]
    fn decoy_keeps_slots_on_the_significant_digits_grid() {
        let constraint = make_constraint(Some(0.0), Some(100.0), None);
        let correct = 23.4759;
        let decoys = [
            DecoyAnchor {
                value: 23.4694, // rounds to 23.469 — kept
                requested_count: 1,
            },
            DecoyAnchor {
                value: 23.4757, // rounds to 23.476 — collides, dropped
                requested_count: 3,
            },
        ];
        let mut rng = StdRng::seed_from_u64(7);
        let (options, _pos, _alt) = generate_numeric_options(
            correct, &decoys, None, &constraint, &mut rng, "medium", 5, false, None, Some(5),
        )
        .unwrap();
        assert!(options.iter().any(|o| (o - 23.469).abs() < 1e-9));
        assert_eq!(
            options.iter().filter(|o| (**o - 23.476).abs() < 1e-9).count(),
            1,
            "the decoy rounding onto the correct answer must be dropped: {options:?}"
        );
    }

    /// Without an override, "medium" caps relative deviation at 50% — no
    /// distractor can ever land further than that from the correct answer.
    /// A 90% override must be able to exceed that ceiling.
    #[test]
    fn spread_override_widens_beyond_the_difficulty_preset_for_closed_options() {
        let constraint = make_constraint(Some(0.0), Some(1_000_000.0), None);
        let correct = 100.0;

        let mut max_relative_deviation_without_override = 0.0_f64;
        for seed in 0..30 {
            let mut rng = StdRng::seed_from_u64(seed);
            let (options, _pos, _alt) =
                generate_numeric_options(correct, &[], None, &constraint, &mut rng, "medium", 5, false, None, None)
                    .unwrap();
            for o in &options {
                let rel = (o - correct).abs() / correct;
                max_relative_deviation_without_override = max_relative_deviation_without_override.max(rel);
            }
        }
        assert!(
            max_relative_deviation_without_override <= 0.51,
            "medium preset should never exceed ~50% deviation, got {max_relative_deviation_without_override}"
        );

        let mut max_relative_deviation_with_override = 0.0_f64;
        for seed in 0..30 {
            let mut rng = StdRng::seed_from_u64(seed);
            let (options, _pos, _alt) = generate_numeric_options(
                correct, &[], None, &constraint, &mut rng, "medium", 5, false, Some(0.9), None,
            )
            .unwrap();
            for o in &options {
                let rel = (o - correct).abs() / correct;
                max_relative_deviation_with_override = max_relative_deviation_with_override.max(rel);
            }
        }
        assert!(
            max_relative_deviation_with_override > 0.55,
            "a 90% override should be able to exceed the medium preset's 50% ceiling, got {max_relative_deviation_with_override}"
        );
    }

    #[test]
    fn spread_override_widens_open_interval_beyond_the_difficulty_preset() {
        let constraint = make_constraint(None, None, None);
        let (lo, hi) = open_interval(100.0, &constraint, "medium", Some(0.9));
        assert!((lo - 10.0).abs() < 1e-9, "expected lower bound 10.0, got {lo}");
        assert!((hi - 190.0).abs() < 1e-9, "expected upper bound 190.0, got {hi}");
    }

    #[test]
    fn spread_override_loses_to_explicit_sd_allowed() {
        let constraint =
            ResultConstraint::new(Uuid::new_v4(), None, None, Some(2.5), ConstraintType::Sd);
        let (lo, hi) = open_interval(100.0, &constraint, "easy", Some(0.9));
        assert!(
            (lo - 97.5).abs() < 1e-9,
            "sd_allowed must win over spread_override: unexpected lower bound {lo}"
        );
        assert!(
            (hi - 102.5).abs() < 1e-9,
            "sd_allowed must win over spread_override: unexpected upper bound {hi}"
        );
    }

    #[test]
    fn invalid_spread_override_values_fall_back_to_preset() {
        let constraint = make_constraint(None, None, None);
        for bad in [Some(0.0), Some(-0.5), Some(f64::NAN), Some(f64::INFINITY)] {
            let (lo, hi) = open_interval(100.0, &constraint, "medium", bad);
            assert!(
                (lo - 70.0).abs() < 1e-9,
                "bad override {bad:?} should fall back to preset, got lo={lo}"
            );
            assert!(
                (hi - 130.0).abs() < 1e-9,
                "bad override {bad:?} should fall back to preset, got hi={hi}"
            );
        }

        // Same guard inside generate_numeric_options: a bad override must
        // not change the closed-option deviation range from the preset.
        let correct = 100.0;
        let closed_constraint = make_constraint(Some(0.0), Some(1_000_000.0), None);
        for bad in [Some(0.0), Some(-0.5), Some(f64::NAN)] {
            let mut rng = StdRng::seed_from_u64(1);
            let (options, _pos, _alt) = generate_numeric_options(
                correct, &[], None, &closed_constraint, &mut rng, "medium", 5, false, bad, None,
            )
            .unwrap();
            for o in &options {
                let rel = (o - correct).abs() / correct;
                assert!(
                    rel <= 0.51,
                    "bad override {bad:?} should fall back to the medium preset's ~50% ceiling, got {rel}"
                );
            }
        }
    }
}
