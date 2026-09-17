//! The student practice generator: endless questions drawn from the topics
//! teachers have authored, and the leaderboard built from how many of them
//! each student got right.
//!
//! Like `commands::auth`, these are plain functions rather than
//! `#[tauri::command]`s — the desktop build has no accounts, so only the HTTP
//! server (`src/http`) calls into this module.
//!
//! The shape of every question served here is the same one the teacher's
//! generator produces: the very same `generate_variant_with_targets` over the
//! very same template, variables, constants and constraints. A student is
//! practising on exactly what a teacher would put on a test, with fresh
//! numbers each time.

use crate::commands::generation::load_template_dependencies;
use crate::commands::test_session::TEST_POINT_VALUE_BANDS;
use crate::db::repos::{
    ConstantRepo, LeaderboardRow, PracticeAttemptRecord, PracticeRepo, StreakRunRepo,
    TemplateDecoyRepo, TemplateRepo, TestSessionRepo,
};
use crate::db::DbError;
use crate::engine::answer_targets::{apply_result_units, extract_target_symbols};
use crate::engine::generator::generate_variant_with_targets;
use crate::models::{AnswerField, TemplateMode, TestKind, Variant};
use chrono::{Duration, Utc};
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Practice questions always use the middle tolerance/spread setting. The
/// teacher-facing difficulty control (easy/medium/hard, which widens or
/// narrows the accepted answer interval and the distractor spread) is a
/// separate axis from the 2/3/4-point difficulty a student picks, and there
/// is nowhere in the student UI to choose it.
const PRACTICE_DIFFICULTY: &str = "medium";

/// Matches the teacher generator's default for closed questions (a–e).
const PRACTICE_OPTION_COUNT: u8 = 5;

/// How many different templates to try before giving up on a topic. A single
/// template can fail to generate (its constraints may be unsatisfiable for
/// the sampled values), which must not read to the student as "this whole
/// topic is broken" while other questions in it are fine.
const MAX_TEMPLATE_ATTEMPTS: usize = 8;

/// Relative slack when a question carries no tolerance interval — only
/// possible for a stored attempt whose mode is open but whose interval
/// columns are somehow empty. 0.1 % accommodates the student rounding an
/// intermediate step without accepting a genuinely different answer.
const FALLBACK_RELATIVE_TOLERANCE: f64 = 1e-3;

// ---------------------------------------------------------------------------
// Payloads and DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextQuestionPayload {
    pub topic_id: Uuid,
    pub point_value: u8,
    /// Restrict the served question to this mode. `None` (the default, and
    /// what every request before this field existed sent) keeps the original
    /// behavior of drawing from whichever mode(s) the topic/difficulty has.
    #[serde(default)]
    pub mode: Option<TemplateMode>,
    /// Restrict the served question to this one set (sada). `None` draws
    /// from every set at the topic/difficulty, the original behavior.
    #[serde(default)]
    pub set_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAnswerPayload {
    pub attempt_id: Uuid,
    /// Closed mode: the 1-based option the student picked.
    pub selected_option: Option<u8>,
    /// Open mode: one value per answer field, in the order they were served.
    pub answers: Option<Vec<f64>>,
}

/// A topic as offered to a student, with the point values it actually has
/// questions for — offering a difficulty that would immediately fail to
/// generate anything is worse than not offering it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeTopic {
    pub id: Uuid,
    pub name: String,
    /// The teacher's "Test" flag: the topic doubles as a timed test in the
    /// test generator, on top of being practisable here.
    pub is_test: bool,
    pub difficulties: Vec<PracticeDifficulty>,
}

/// A topic offered in the student test generator: the teacher flagged it as
/// a test AND it has enough questions to fill all three point-value bands.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestTopicOption {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeDifficulty {
    pub point_value: u8,
    pub question_count: i64,
    /// The individual sets (sada) this difficulty draws from, so a student
    /// can narrow practice down to one of them instead of the whole
    /// difficulty. Never empty when `question_count` is nonzero.
    pub sets: Vec<PracticeSetOption>,
}

/// One set (sada) a student can restrict practice to, alongside "any set"
/// (the default, `set_id: None` in `NextQuestionPayload`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeSetOption {
    pub id: Uuid,
    /// The teacher's chosen name, or `None` when the set only has its
    /// default "Sada {index}" label — the frontend already knows how to
    /// fall back to that, same as the teacher-facing set list.
    pub name: Option<String>,
    pub set_index: u8,
    pub mode: TemplateMode,
    pub question_count: i64,
}

/// A variable paired with the placeholder it fills in the question text —
/// exactly what the shared question renderer needs to substitute `[[X]]`.
/// Structurally a subset of the teacher-side `VariableWithPlaceholder`, minus
/// the authoring-only fields (sharing, comparison links) a student's view has
/// no use for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeVariable {
    pub variable: crate::models::Variable,
    pub placeholder: String,
}

/// One blank a student has to fill in. For an ordinary single-answer question
/// there is exactly one, carrying the template's own result unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeAnswerSlot {
    /// `None` for a single-answer question; the target symbol (`n`, `m`, …)
    /// for a question that asks for several quantities at once.
    pub symbol: Option<String>,
    pub unit: Option<String>,
    /// Closed mode only: the options to choose between, in display order.
    pub numeric_options: Option<Vec<f64>>,
    /// The template's result significant-figures setting, so the practice UI
    /// can format options and the revealed correct answer on the same grid
    /// the engine generated them. `#[serde(default)]` keeps teacher report
    /// snapshots stored before this field existed deserializable.
    #[serde(default)]
    pub significant_digits: Option<u8>,
    /// Per-option significant-digit overrides, parallel to `numeric_options`:
    /// an entry is Some(n) when that option belongs to a decoy (or is the
    /// alternace) configured with its own significant digits. `None` (or a
    /// `None` entry) falls back to `significant_digits`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_sig_digits: Option<Vec<Option<u8>>>,
}

/// A question ready to be answered. Deliberately carries no correct answer,
/// correct option, or tolerance interval — those stay in `practice_attempts`
/// until the student has committed to an answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeQuestion {
    pub attempt_id: Uuid,
    pub question_text: String,
    pub point_value: u8,
    pub mode: TemplateMode,
    pub result_unit: String,
    pub variables: Vec<PracticeVariable>,
    pub assigned_values: HashMap<String, f64>,
    pub assigned_strings: HashMap<String, String>,
    /// Every constant the question text may reference, so the renderer can
    /// substitute `[[NA]]`-style placeholders without a teacher-only call to
    /// `list_constants`.
    pub constants: HashMap<String, f64>,
    pub answer_slots: Vec<PracticeAnswerSlot>,
    /// The template's own "always scientific" toggle. `false` means the
    /// teacher explicitly wants plain decimal (`12300`, not `1.23×10⁴`) —
    /// the frontend must honor that outright rather than falling back to a
    /// magnitude-based heuristic that would still flip small values (e.g.
    /// `0.012`) to scientific notation against the teacher's own setting.
    #[serde(default)]
    pub force_scientific: bool,
}

/// The verdict, returned once and only once per attempt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeAnswerResult {
    pub correct: bool,
    pub point_value: u8,
    /// Closed mode: which option was right.
    pub correct_option: Option<u8>,
    /// Closed mode: the "alternace" option, if the template has one — also
    /// graded correct, and highlighted alongside `correct_option`.
    pub alternate_option: Option<u8>,
    /// What the answer should have been, one entry per answer slot.
    pub correct_answers: Vec<PracticeCorrectAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeCorrectAnswer {
    pub symbol: Option<String>,
    pub value: f64,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub user_id: Uuid,
    pub username: String,
    pub correct_count: i64,
    pub answered_count: i64,
    pub points: i64,
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/// Student-visible topics (for_students) with at least one question, each
/// listing the difficulties it can actually serve. Teacher-only topics are
/// skipped here even when they are tests: the test picker has its own list.
pub fn do_list_practice_topics(conn: &Connection) -> Result<Vec<PracticeTopic>, DbError> {
    let rows = PracticeRepo::list_practice_topics(conn)?;
    let set_rows = PracticeRepo::list_practice_sets(conn)?;

    // Rows arrive ordered by (topic name, point value), so consecutive rows
    // for one topic fold into a single entry without a lookup map.
    let mut topics: Vec<PracticeTopic> = Vec::new();
    for row in rows {
        if !row.for_students {
            continue;
        }
        let sets = set_rows
            .iter()
            .filter(|s| s.topic_id == row.topic_id && s.point_value == row.point_value)
            .map(|s| PracticeSetOption {
                id: s.set_id,
                name: s.name.clone(),
                set_index: s.set_index,
                mode: s.mode,
                question_count: s.question_count,
            })
            .collect();

        match topics.last_mut() {
            Some(topic) if topic.id == row.topic_id => {
                topic.difficulties.push(PracticeDifficulty {
                    point_value: row.point_value,
                    question_count: row.question_count,
                    sets,
                });
            }
            _ => topics.push(PracticeTopic {
                id: row.topic_id,
                name: row.name,
                is_test: row.is_test,
                difficulties: vec![PracticeDifficulty {
                    point_value: row.point_value,
                    question_count: row.question_count,
                    sets,
                }],
            }),
        }
    }

    Ok(topics)
}

/// Topics offered as `kind` in the student test generator: flagged as a
/// test by the teacher (independently of practice visibility, so a
/// test-only topic is offered here even though it never shows up in the
/// endless generator), offering that kind, and holding at least
/// `kind.questions_per_band()` questions at each of the three point values
/// (2/3/4), so every test can always be filled to its full shape.
///
/// The bar therefore differs by kind: a topic with 4 questions in a band
/// can serve as a průběžný test but not as an úvodní one, even when it is
/// marked as offering both. A flagged topic that does not meet the bar is
/// simply not offered yet — it becomes available the moment the teacher
/// adds enough questions.
pub fn do_list_test_topics(
    conn: &Connection,
    kind: TestKind,
) -> Result<Vec<TestTopicOption>, DbError> {
    let rows = PracticeRepo::list_practice_topics(conn)?;
    let per_band = kind.questions_per_band() as i64;

    // Rows arrive ordered by (topic name, point value), so consecutive rows
    // for one flagged topic fold into a single candidate, remembering each
    // band's question count.
    let mut candidates: Vec<(Uuid, String, Vec<(u8, i64)>)> = Vec::new();
    for row in rows
        .into_iter()
        .filter(|row| row.is_test && row.test_kind.offers(kind))
    {
        let band = (row.point_value, row.question_count);
        match candidates.last_mut() {
            Some(candidate) if candidate.0 == row.topic_id => candidate.2.push(band),
            _ => candidates.push((row.topic_id, row.name, vec![band])),
        }
    }

    Ok(candidates
        .into_iter()
        .filter(|(_, _, bands)| {
            TEST_POINT_VALUE_BANDS.iter().all(|band| {
                bands
                    .iter()
                    .any(|(pv, count)| *pv == *band && *count >= per_band)
            })
        })
        .map(|(id, name, _)| TestTopicOption { id, name })
        .collect())
}

// ---------------------------------------------------------------------------
// Serving a question
// ---------------------------------------------------------------------------

/// A fresh random question from `topic_id` at the requested point value. Mode
/// (open/closed) is not a separate random choice: it comes from whichever
/// set the randomly picked template actually belongs to, so a question never
/// gets served in a mode its set wasn't configured for. If `payload.mode` is
/// set, only templates whose set actually has that mode are considered. If
/// `payload.set_id` is set, only that one set's templates are considered.
pub fn do_next_question(
    conn: &Connection,
    user_id: &Uuid,
    payload: &NextQuestionPayload,
) -> Result<PracticeQuestion, DbError> {
    let mut template_ids = PracticeRepo::list_template_ids(
        conn,
        &payload.topic_id,
        payload.point_value,
        payload.set_id.as_ref(),
    )?;
    if let Some(wanted) = payload.mode {
        template_ids.retain(|(_, mode)| *mode == wanted);
    }
    if template_ids.is_empty() {
        return Err(DbError::NotFound(
            "Pro toto téma, obtížnost a typ otázek zatím nejsou žádné otázky".into(),
        ));
    }

    let mut rng = StdRng::seed_from_u64(entropy_seed());
    let mut last_error: Option<DbError> = None;

    for _ in 0..MAX_TEMPLATE_ATTEMPTS.min(template_ids.len().saturating_mul(2)) {
        let (template_id, mode) = template_ids[rng.random_range(0..template_ids.len())];

        match build_question(
            conn,
            user_id,
            &payload.topic_id,
            &template_id,
            mode,
            &mut rng,
            None,
            None,
            None,
        ) {
            Ok(question) => return Ok(question),
            Err(e) => last_error = Some(e),
        }
    }

    Err(last_error.unwrap_or_else(|| {
        DbError::Validation("Nepodařilo se vygenerovat otázku, zkuste to znovu".into())
    }))
}

/// Generate and serve one question, optionally tagging its `practice_attempts`
/// row into a fixed-batch test session (`crate::commands::test_session`) via
/// `test_session_id`/`position`, or into an endless streak run
/// (`crate::commands::streak_run`) via `streak_run_id`. All `None` for
/// ordinary endless practice; a caller passes at most one of the two kinds.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_question(
    conn: &Connection,
    user_id: &Uuid,
    topic_id: &Uuid,
    template_id: &Uuid,
    mode: TemplateMode,
    rng: &mut StdRng,
    test_session_id: Option<Uuid>,
    position: Option<i64>,
    streak_run_id: Option<Uuid>,
) -> Result<PracticeQuestion, DbError> {
    let template = TemplateRepo::get_by_id(conn, template_id)?;
    let (variables, constants, constraint, fixed_values) =
        load_template_dependencies(conn, &template)?;
    let mut targets = extract_target_symbols(&template.question_text);
    apply_result_units(&mut targets, &template.result_unit);
    let decoys = TemplateDecoyRepo::list_by_template(conn, &template.id)?;

    // Interactive student practice keeps the correct answer's position
    // random — only teacher-facing generation forces it to R1/A.
    let difficulty = PRACTICE_DIFFICULTY;
    let variant = generate_variant_with_targets(
        template.id,
        &template.formula,
        &variables,
        &constants,
        &constraint,
        mode,
        rng.random_range(0..u64::MAX),
        difficulty,
        PRACTICE_OPTION_COUNT,
        &fixed_values,
        &targets,
        &decoys,
        template.alternative_formula.as_deref(),
        false,
        None,
        template.significant_digits,
        template.alternative_significant_digits,
    )
    .map_err(|e| DbError::Validation(e.to_string()))?;

    let attempt = PracticeAttemptRecord {
        id: Uuid::new_v4(),
        user_id: *user_id,
        template_id: template.id,
        topic_id: *topic_id,
        point_value: template.point_value,
        mode,
        correct_answer: variant.correct_answer,
        correct_option: variant.correct_option,
        alternate_option: variant.alternate_option,
        interval_lo: variant.interval_lo,
        interval_hi: variant.interval_hi,
        answers_data: variant.answers_data.clone(),
        assigned_values: variant.assigned_values.clone(),
        assigned_strings: variant.assigned_strings.clone(),
        numeric_options: variant.numeric_options.clone(),
        option_sig_digits: variant.option_sig_digits.clone(),
        test_session_id,
        position,
        streak_run_id,
    };
    PracticeRepo::insert(conn, &attempt)?;

    // The placeholders in the question text are resolved against the
    // template's own variables first; anything left over (a constant symbol
    // like NA) comes from the same auto-resolved constant map the generator
    // used, so the rendered question can never show a bare `[[NA]]`.
    let placeholder_by_variable_id: HashMap<Uuid, String> =
        TemplateRepo::get_variables(conn, &template.id)?
            .into_iter()
            .map(|tv| (tv.variable_id, tv.placeholder))
            .collect();

    let practice_variables = variables
        .into_iter()
        .map(|variable| PracticeVariable {
            placeholder: placeholder_by_variable_id
                .get(&variable.id)
                .cloned()
                .unwrap_or_else(|| variable.symbol.clone()),
            variable,
        })
        .collect();

    Ok(PracticeQuestion {
        attempt_id: attempt.id,
        question_text: template.question_text.clone(),
        point_value: template.point_value,
        mode,
        result_unit: template.result_unit.clone(),
        variables: practice_variables,
        assigned_values: variant.assigned_values.clone(),
        assigned_strings: variant.assigned_strings.clone(),
        constants: constants_for_rendering(conn, &constants)?,
        answer_slots: answer_slots(
            &template.result_unit,
            mode,
            &variant,
            template.significant_digits,
        ),
        force_scientific: template.force_scientific,
    })
}

/// The generator's resolved constants, plus every globally defined constant —
/// the question text can reference a constant the *formula* never mentions
/// (so `load_template_dependencies` wouldn't have resolved it), and the
/// teacher UI likewise renders against the full global table.
pub fn constants_for_rendering(
    conn: &Connection,
    resolved: &HashMap<String, f64>,
) -> Result<HashMap<String, f64>, DbError> {
    let mut constants: HashMap<String, f64> = ConstantRepo::list_all(conn)?
        .into_iter()
        .map(|c| (c.symbol, c.value))
        .collect();
    constants.extend(resolved.iter().map(|(k, v)| (k.clone(), *v)));
    Ok(constants)
}

/// One slot per answer the question asks for, carrying the closed-mode
/// options but never which of them is right.
pub fn answer_slots(
    result_unit: &str,
    mode: TemplateMode,
    variant: &Variant,
    significant_digits: Option<u8>,
) -> Vec<PracticeAnswerSlot> {
    let closed = matches!(mode, TemplateMode::Closed);

    match variant.answers_data.as_ref() {
        Some(fields) if !fields.is_empty() => fields
            .iter()
            .map(|field| PracticeAnswerSlot {
                symbol: Some(field.symbol.clone()),
                unit: field.unit.clone(),
                numeric_options: if closed {
                    field.numeric_options.clone()
                } else {
                    None
                },
                // Every slot inherits the template-level setting, plus this
                // target's per-option decoy/alternace overrides.
                significant_digits,
                option_sig_digits: if closed {
                    field.option_sig_digits.clone()
                } else {
                    None
                },
            })
            .collect(),
        _ => vec![PracticeAnswerSlot {
            symbol: None,
            unit: (!result_unit.is_empty()).then(|| result_unit.to_string()),
            numeric_options: if closed {
                variant.numeric_options.clone()
            } else {
                None
            },
            significant_digits,
            option_sig_digits: if closed {
                variant.option_sig_digits.clone()
            } else {
                None
            },
        }],
    }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/// Grade a submitted answer and record the outcome. An attempt can be graded
/// exactly once (see `PracticeRepo::find_pending`), so a wrong answer stays
/// wrong on the leaderboard.
pub fn do_submit_answer(
    conn: &Connection,
    user_id: &Uuid,
    payload: &SubmitAnswerPayload,
) -> Result<PracticeAnswerResult, DbError> {
    let attempt = PracticeRepo::find_pending(conn, &payload.attempt_id, user_id)?
        .ok_or_else(|| DbError::NotFound("Tato otázka už byla vyhodnocena".into()))?;

    // A question served as part of a test session must stop accepting
    // answers once that session is over: grading authority lives here on
    // the server, so a client that keeps a stale timed-test page open past
    // its deadline (or after "Finish" was already pressed) must not still
    // be able to score.
    if let Some(session_id) = attempt.test_session_id {
        if let Some(session) = TestSessionRepo::get_owned(conn, &session_id, user_id)? {
            if session.finished_at.is_some() {
                return Err(DbError::Validation("Test už byl ukončen".into()));
            }
            if let Some(limit) = session.time_limit_seconds {
                let deadline = session.started_at + Duration::seconds(limit as i64);
                if Utc::now() > deadline {
                    return Err(DbError::Validation("Čas na test už vypršel".into()));
                }
            }
        }
    }

    // A streak run stops taking answers the instant it has already failed —
    // its final score is frozen at the first wrong answer, so a client that
    // still holds a question served just before that must not be able to
    // sneak in one more (correct or not) afterward.
    if let Some(run_id) = attempt.streak_run_id {
        if let Some(run) = StreakRunRepo::get_owned(conn, &run_id, user_id)? {
            if run.failed {
                return Err(DbError::Validation("Tato série už skončila".into()));
            }
        }
    }

    let correct = match attempt.mode {
        TemplateMode::Closed => {
            let selected = payload
                .selected_option
                .ok_or_else(|| DbError::Validation("Vyberte jednu z možností".into()))?;
            Some(selected) == attempt.correct_option
                || (attempt.alternate_option.is_some()
                    && Some(selected) == attempt.alternate_option)
        }
        TemplateMode::Open => {
            let answers = payload.answers.as_deref().unwrap_or(&[]);
            grade_open(&attempt, answers)?
        }
    };

    PracticeRepo::mark_answered(conn, &attempt.id, correct)?;

    if let Some(run_id) = attempt.streak_run_id {
        if correct {
            StreakRunRepo::record_correct(conn, &run_id)?;
        } else {
            StreakRunRepo::record_failure(conn, &run_id)?;
        }
    }

    Ok(PracticeAnswerResult {
        correct,
        point_value: attempt.point_value,
        correct_option: attempt.correct_option,
        alternate_option: attempt.alternate_option,
        correct_answers: correct_answers(&attempt),
    })
}

fn grade_open(attempt: &PracticeAttemptRecord, answers: &[f64]) -> Result<bool, DbError> {
    let expected = attempt
        .answers_data
        .as_ref()
        .map(|fields| fields.len())
        .filter(|len| *len > 0)
        .unwrap_or(1);

    if answers.len() != expected {
        return Err(DbError::Validation(format!(
            "Vyplňte všechny odpovědi ({expected})"
        )));
    }

    match attempt.answers_data.as_ref() {
        Some(fields) if !fields.is_empty() => {
            Ok(fields.iter().zip(answers).all(|(field, answer)| {
                within(*answer, field.value, field.interval_lo, field.interval_hi)
            }))
        }
        _ => Ok(within(
            answers[0],
            attempt.correct_answer,
            attempt.interval_lo,
            attempt.interval_hi,
        )),
    }
}

/// Inside the tolerance interval the generator computed for this question —
/// the very same interval the teacher's exported answer key uses, so a
/// student's practice answer is judged by exactly the test's standard.
fn within(answer: f64, expected: f64, lo: Option<f64>, hi: Option<f64>) -> bool {
    if !answer.is_finite() {
        return false;
    }
    match (lo, hi) {
        // The generator emits the interval lo/hi in ascending order, but a
        // negative expected value would flip a naive ±% computation, so
        // normalise rather than trust the ordering.
        (Some(lo), Some(hi)) => answer >= lo.min(hi) && answer <= lo.max(hi),
        _ => (answer - expected).abs() <= FALLBACK_RELATIVE_TOLERANCE * expected.abs().max(1.0),
    }
}

pub fn correct_answers(attempt: &PracticeAttemptRecord) -> Vec<PracticeCorrectAnswer> {
    match attempt.answers_data.as_ref() {
        Some(fields) if !fields.is_empty() => fields
            .iter()
            .map(|field: &AnswerField| PracticeCorrectAnswer {
                symbol: Some(field.symbol.clone()),
                value: field.value,
                unit: field.unit.clone(),
            })
            .collect(),
        _ => vec![PracticeCorrectAnswer {
            symbol: None,
            value: attempt.correct_answer,
            unit: None,
        }],
    }
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

pub fn do_leaderboard(conn: &Connection) -> Result<Vec<LeaderboardEntry>, DbError> {
    Ok(PracticeRepo::leaderboard(conn)?
        .into_iter()
        .map(|row: LeaderboardRow| LeaderboardEntry {
            user_id: row.user_id,
            username: row.username,
            correct_count: row.correct_count,
            answered_count: row.answered_count,
            points: row.points,
        })
        .collect())
}

/// A CSPRNG-backed seed drawn from a v4 UUID — the same source of randomness
/// this codebase already relies on for session tokens (see
/// `commands::auth::generate_token`), so no new dependency or RNG-API
/// surface is introduced just to shuffle question order.
pub(crate) fn entropy_seed() -> u64 {
    let bytes = Uuid::new_v4().into_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("a UUID is 16 bytes"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::{CategoryRepo, SetRepo, TopicRepo, UserRecord, UserRepo, VariableRepo};
    use crate::models::{
        ConstraintType, ResultConstraint, Role, Template, TemplateVariable, TestOffer, Topic,
        Variable,
    };
    use chrono::Utc;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::schema::run_migrations(&conn).expect("migrations");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk on");
        conn
    }

    fn insert_student(conn: &Connection, username: &str) -> Uuid {
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.into(),
            password_hash: "h".into(),
            role: Role::Student,
            created_at: Utc::now(),
            protected: false,
            email: None,
        };
        UserRepo::insert(conn, &user).expect("insert user");
        user.id
    }

    /// A topic with one 2-point question ("double X"), wired up the way the
    /// importer does it: topic → category → set → template.
    fn seed_topic(conn: &Connection, name: &str, point_value: u8) -> Uuid {
        let mut topic = Topic::new(name.to_string());
        // Every test in this module exercises the student-facing practice
        // flow, which only ever lists topics opted in for students.
        topic.for_students = true;
        crate::db::repos::TopicRepo::insert(conn, &topic).expect("insert topic");

        let (_, sets) = CategoryRepo::create(conn, topic.id, point_value).expect("create category");

        let variable = Variable::new("Hmotnost".into(), "X".into(), 1.0, 10.0, 1.0, "g".into(), 0);
        VariableRepo::insert_raw(conn, &variable).expect("insert variable");

        // Question text is globally unique (see migration v11), so vary it
        // per topic — a test seeding two topics must not trip that index.
        let template = Template::new(
            format!("{name}: kolik je dvojnásobek [[X]] g? [Y]"),
            "Y = X * 2".into(),
            "Y = X × 2".into(),
            None,
            "g".into(),
            point_value,
        );
        let constraint = ResultConstraint::new(
            template.id,
            Some(0.0),
            Some(100.0),
            None,
            ConstraintType::Range,
        );
        let tv = TemplateVariable {
            template_id: template.id,
            variable_id: variable.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &[])
            .expect("insert template");
        SetRepo::add_template(conn, &sets[0].id, &template.id).expect("add template to set");

        topic.id
    }

    /// Same "double X" question as `seed_topic`, but with an "alternace"
    /// formula attached — for tests exercising the second correct
    /// closed-mode option.
    fn seed_topic_with_alternative_formula(
        conn: &Connection,
        name: &str,
        point_value: u8,
        alternative_formula: &str,
    ) -> Uuid {
        let mut topic = Topic::new(name.to_string());
        topic.for_students = true;
        crate::db::repos::TopicRepo::insert(conn, &topic).expect("insert topic");

        let (_, sets) = CategoryRepo::create(conn, topic.id, point_value).expect("create category");

        let variable = Variable::new("Hmotnost".into(), "X".into(), 1.0, 10.0, 1.0, "g".into(), 0);
        VariableRepo::insert_raw(conn, &variable).expect("insert variable");

        let mut template = Template::new(
            format!("{name}: kolik je dvojnásobek [[X]] g? [Y]"),
            "Y = X * 2".into(),
            "Y = X × 2".into(),
            None,
            "g".into(),
            point_value,
        );
        template.alternative_formula = Some(alternative_formula.to_string());
        let constraint = ResultConstraint::new(
            template.id,
            Some(0.0),
            Some(100.0),
            None,
            ConstraintType::Range,
        );
        let tv = TemplateVariable {
            template_id: template.id,
            variable_id: variable.id,
            placeholder: "X".into(),
            greater_than_variable_id: None,
            less_than_variable_id: None,
        };
        TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &[])
            .expect("insert template");
        SetRepo::add_template(conn, &sets[0].id, &template.id).expect("add template to set");

        topic.id
    }

    #[test]
    fn practice_topics_list_only_difficulties_that_have_questions() {
        let conn = setup_conn();
        seed_topic(&conn, "Roztoky", 2);
        seed_topic(&conn, "Ředění", 4);

        let topics = do_list_practice_topics(&conn).expect("list topics");
        assert_eq!(topics.len(), 2);

        let roztoky = topics
            .iter()
            .find(|t| t.name == "Roztoky")
            .expect("Roztoky");
        assert_eq!(roztoky.difficulties.len(), 1);
        assert_eq!(roztoky.difficulties[0].point_value, 2);
        assert_eq!(roztoky.difficulties[0].question_count, 1);
    }

    /// Seeds a topic with `questions_per_band` questions at each of the 2/3/4
    /// point values, carrying exactly the visibility flags passed in.
    fn seed_topic_full(
        conn: &Connection,
        name: &str,
        for_students: bool,
        is_test: bool,
        questions_per_band: usize,
    ) -> Uuid {
        let mut topic = Topic::new(name.to_string());
        topic.for_students = for_students;
        topic.is_test = is_test;
        crate::db::repos::TopicRepo::insert(conn, &topic).expect("insert topic");

        for point_value in crate::commands::test_session::TEST_POINT_VALUE_BANDS {
            let (_, sets) =
                CategoryRepo::create(conn, topic.id, point_value).expect("create category");
            for i in 0..questions_per_band {
                let variable = Variable::new(
                    format!("{name} {point_value} {i}"),
                    "X".into(),
                    1.0,
                    10.0,
                    1.0,
                    "g".into(),
                    0,
                );
                VariableRepo::insert_raw(conn, &variable).expect("insert variable");
                let template = Template::new(
                    format!("{name} {point_value} {i}: kolik je dvojnásobek [[X]] g? [Y]"),
                    "Y = X * 2".into(),
                    "Y = X × 2".into(),
                    None,
                    "g".into(),
                    point_value,
                );
                let constraint = ResultConstraint::new(
                    template.id,
                    Some(0.0),
                    Some(100.0),
                    None,
                    ConstraintType::Range,
                );
                let tv = TemplateVariable {
                    template_id: template.id,
                    variable_id: variable.id,
                    placeholder: "X".into(),
                    greater_than_variable_id: None,
                    less_than_variable_id: None,
                };
                TemplateRepo::insert(conn, &template, &[tv], &[], Some(&constraint), &[])
                    .expect("insert template");
                SetRepo::add_template(conn, &sets[i % 3].id, &template.id).expect("add to set");
            }
        }

        topic.id
    }

    /// The two visibility flags are independent: a test-only topic
    /// (for_students = 0, is_test = 1) must be offered in the test picker
    /// even though it never shows up in the endless practice generator, and
    /// an underfilled test stays hidden until every band has its 4 questions.
    #[test]
    fn test_topics_listing_is_independent_of_practice_visibility() {
        let conn = setup_conn();
        seed_topic_full(&conn, "TestOnly", false, true, 4);
        seed_topic_full(&conn, "Practice", true, false, 4);
        seed_topic_full(&conn, "Underfilled", false, true, 3);
        seed_topic_full(&conn, "Both", true, true, 5);

        let tests = do_list_test_topics(&conn, TestKind::Prubezny).expect("list test topics");
        let names: Vec<&str> = tests.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["Both", "TestOnly"]);

        let practice = do_list_practice_topics(&conn).expect("list practice topics");
        let pnames: Vec<&str> = practice.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(pnames, vec!["Both", "Practice"]);
    }

    /// The picker is per kind twice over: a topic only offers the kind(s)
    /// the teacher chose, and the band bar is the kind's own — 5 questions
    /// for úvodní, 4 for průběžný — so a topic can be listed for one and
    /// not the other even when it is marked as offering both.
    #[test]
    fn test_topics_listing_is_filtered_by_kind_and_its_band_size() {
        let conn = setup_conn();
        let set_offer = |id: Uuid, offer: TestOffer| {
            let mut topic = TopicRepo::get_by_id(&conn, &id).expect("get topic");
            topic.test_kind = offer;
            TopicRepo::update(&conn, &topic).expect("update topic");
        };

        // Big enough for either kind, but offered as one only.
        set_offer(
            seed_topic_full(&conn, "JenUvodni", false, true, 5),
            TestOffer::Uvodni,
        );
        set_offer(
            seed_topic_full(&conn, "JenPrubezny", false, true, 5),
            TestOffer::Prubezny,
        );
        // Offers both, but its bands only reach the průběžný bar.
        set_offer(
            seed_topic_full(&conn, "ObojiMale", false, true, 4),
            TestOffer::Both,
        );
        set_offer(
            seed_topic_full(&conn, "ObojiVelke", false, true, 5),
            TestOffer::Both,
        );

        let names = |kind| -> Vec<String> {
            do_list_test_topics(&conn, kind)
                .expect("list")
                .into_iter()
                .map(|t| t.name)
                .collect()
        };

        assert_eq!(names(TestKind::Uvodni), vec!["JenUvodni", "ObojiVelke"]);
        assert_eq!(
            names(TestKind::Prubezny),
            vec!["JenPrubezny", "ObojiMale", "ObojiVelke"]
        );
    }

    /// A template linked only into an open set must never be served closed,
    /// and vice versa. This is the fix for `do_next_question` previously
    /// coin-flipping mode independently of which set(s) a template belongs to.
    #[test]
    fn next_question_only_ever_uses_the_templates_actual_set_mode() {
        let conn = setup_conn();
        let topic_id = seed_topic(&conn, "Roztoky", 2); // template lives in sets[0], Closed
        let student = insert_student(&conn, "student");

        for _ in 0..30 {
            let question = do_next_question(
                &conn,
                &student,
                &NextQuestionPayload {
                    topic_id,
                    point_value: 2,
                    mode: None,
                    set_id: None,
                },
            )
            .expect("serve question");
            assert_eq!(
                question.mode,
                TemplateMode::Closed,
                "a template only in a closed set must never be served open"
            );
        }
    }

    #[test]
    fn next_question_never_leaks_the_answer() {
        let conn = setup_conn();
        let topic_id = seed_topic(&conn, "Roztoky", 3);
        let student = insert_student(&conn, "student");

        let question = do_next_question(
            &conn,
            &student,
            &NextQuestionPayload {
                topic_id,
                point_value: 3,
                mode: None,
                set_id: None,
            },
        )
        .expect("serve question");

        assert_eq!(question.point_value, 3);
        assert_eq!(question.answer_slots.len(), 1);

        // The whole point of grading server-side: nothing in the payload the
        // browser receives tells the student what to answer.
        let json = serde_json::to_string(&question).expect("serialize");
        assert!(!json.contains("correctAnswer"), "{json}");
        assert!(!json.contains("correctOption"), "{json}");
        assert!(!json.contains("intervalLo"), "{json}");

        match question.mode {
            TemplateMode::Closed => {
                let options = question.answer_slots[0]
                    .numeric_options
                    .as_ref()
                    .expect("closed questions carry options");
                assert_eq!(options.len(), PRACTICE_OPTION_COUNT as usize);
            }
            TemplateMode::Open => {
                assert!(question.answer_slots[0].numeric_options.is_none());
            }
        }
    }

    /// Guards against accidentally flipping `force_correct_first` to `true`
    /// for student practice: unlike teacher-mode generation (which always
    /// places the correct answer at position 1), interactive practice must
    /// keep the position randomized across questions.
    #[test]
    fn practice_questions_keep_random_correct_option_position() {
        let conn = setup_conn();
        let topic_id = seed_topic(&conn, "Roztoky", 3);
        let student = insert_student(&conn, "student");

        for _ in 0..40 {
            let _ = do_next_question(
                &conn,
                &student,
                &NextQuestionPayload {
                    topic_id,
                    point_value: 3,
                    mode: None,
                    set_id: None,
                },
            );
        }

        let positions: Vec<i64> = {
            let mut stmt = conn
                .prepare(
                    "SELECT correct_option FROM practice_attempts \
                     WHERE user_id = ?1 AND mode = 'closed' AND correct_option IS NOT NULL",
                )
                .expect("prepare");
            stmt.query_map(rusqlite::params![student], |row| row.get(0))
                .expect("query")
                .collect::<rusqlite::Result<_>>()
                .expect("collect")
        };

        assert!(
            positions.len() > 5,
            "expected multiple closed-mode attempts among 40 requests, got {}",
            positions.len()
        );
        let unique: std::collections::HashSet<i64> = positions.iter().cloned().collect();
        assert!(
            unique.len() > 1,
            "student practice must keep the correct answer's position random, got {:?}",
            positions
        );
    }

    /// The full loop a student goes through, on a question whose answer is
    /// derivable from the served values (double the assigned X).
    #[test]
    fn a_correct_answer_scores_and_a_wrong_one_does_not() {
        let conn = setup_conn();
        let topic_id = seed_topic(&conn, "Roztoky", 2);
        let student = insert_student(&conn, "student");

        let mut scored = 0;
        for _ in 0..12 {
            let question = do_next_question(
                &conn,
                &student,
                &NextQuestionPayload {
                    topic_id,
                    point_value: 2,
                    mode: None,
                    set_id: None,
                },
            )
            .expect("serve question");

            let expected = question.assigned_values["X"] * 2.0;

            let payload = match question.mode {
                TemplateMode::Open => SubmitAnswerPayload {
                    attempt_id: question.attempt_id,
                    selected_option: None,
                    answers: Some(vec![expected]),
                },
                TemplateMode::Closed => {
                    let options = question.answer_slots[0]
                        .numeric_options
                        .clone()
                        .expect("options");
                    let position = options
                        .iter()
                        .position(|o| (o - expected).abs() < 1e-9)
                        .expect("the correct value is among the options")
                        as u8;
                    SubmitAnswerPayload {
                        attempt_id: question.attempt_id,
                        selected_option: Some(position + 1),
                        answers: None,
                    }
                }
            };

            let result = do_submit_answer(&conn, &student, &payload).expect("grade");
            assert!(result.correct, "answering {expected} should be correct");
            assert_eq!(result.point_value, 2);
            scored += 1;
        }
        assert_eq!(scored, 12);

        let board = do_leaderboard(&conn).expect("leaderboard");
        let me = board.iter().find(|r| r.username == "student").expect("me");
        assert_eq!(me.correct_count, 12);
        assert_eq!(me.points, 24);

        // And a deliberately wrong answer is recorded as wrong.
        let question = do_next_question(
            &conn,
            &student,
            &NextQuestionPayload {
                topic_id,
                point_value: 2,
                mode: None,
                set_id: None,
            },
        )
        .expect("serve question");
        let wrong = match question.mode {
            TemplateMode::Open => SubmitAnswerPayload {
                attempt_id: question.attempt_id,
                selected_option: None,
                answers: Some(vec![-12345.0]),
            },
            TemplateMode::Closed => {
                let expected = question.assigned_values["X"] * 2.0;
                let options = question.answer_slots[0]
                    .numeric_options
                    .clone()
                    .expect("options");
                let wrong_position = options
                    .iter()
                    .position(|o| (o - expected).abs() >= 1e-9)
                    .expect("at least one distractor") as u8;
                SubmitAnswerPayload {
                    attempt_id: question.attempt_id,
                    selected_option: Some(wrong_position + 1),
                    answers: None,
                }
            }
        };
        let result = do_submit_answer(&conn, &student, &wrong).expect("grade");
        assert!(!result.correct);
        assert_eq!(result.correct_answers.len(), 1);

        let board = do_leaderboard(&conn).expect("leaderboard");
        let me = board.iter().find(|r| r.username == "student").expect("me");
        assert_eq!(me.correct_count, 12, "the wrong answer must not score");
        assert_eq!(me.answered_count, 13);
    }

    /// An "alternace" formula's value becomes a second correct closed-mode
    /// option — selecting it must score exactly like selecting the primary
    /// correct option.
    #[test]
    fn selecting_the_alternate_option_also_scores_as_correct() {
        let conn = setup_conn();
        let topic_id = seed_topic_with_alternative_formula(&conn, "Roztoky", 2, "Y * 3");
        let student = insert_student(&conn, "student");

        let mut graded_the_alternate = false;
        for _ in 0..40 {
            let question = do_next_question(
                &conn,
                &student,
                &NextQuestionPayload {
                    topic_id,
                    point_value: 2,
                    mode: None,
                    set_id: None,
                },
            )
            .expect("serve question");
            if question.mode != TemplateMode::Closed {
                continue;
            }
            let expected = question.assigned_values["X"] * 2.0;
            let alternate_value = expected * 3.0;
            let options = question.answer_slots[0]
                .numeric_options
                .clone()
                .expect("closed questions carry options");
            let Some(alt_index) = options
                .iter()
                .position(|o| (o - alternate_value).abs() < 1e-6)
            else {
                continue;
            };

            let payload = SubmitAnswerPayload {
                attempt_id: question.attempt_id,
                selected_option: Some(alt_index as u8 + 1),
                answers: None,
            };
            let result = do_submit_answer(&conn, &student, &payload).expect("grade");
            assert!(
                result.correct,
                "selecting the alternate option should score as correct"
            );
            assert_eq!(result.alternate_option, Some(alt_index as u8 + 1));
            graded_the_alternate = true;
        }

        assert!(
            graded_the_alternate,
            "expected at least one closed-mode attempt in 40 tries to offer the alternate option"
        );
    }

    #[test]
    fn an_attempt_cannot_be_graded_twice() {
        let conn = setup_conn();
        let topic_id = seed_topic(&conn, "Roztoky", 2);
        let student = insert_student(&conn, "student");

        let question = do_next_question(
            &conn,
            &student,
            &NextQuestionPayload {
                topic_id,
                point_value: 2,
                mode: None,
                set_id: None,
            },
        )
        .expect("serve question");

        let payload = SubmitAnswerPayload {
            attempt_id: question.attempt_id,
            selected_option: Some(99),
            answers: Some(vec![-1.0]),
        };
        do_submit_answer(&conn, &student, &payload).expect("first grading");

        // Retrying the same attempt — the obvious way to farm the leaderboard
        // — is refused rather than re-graded.
        let second = do_submit_answer(&conn, &student, &payload);
        assert!(matches!(second, Err(DbError::NotFound(_))));
    }

    /// A student explicitly asking for a mode a topic has no questions in
    /// gets the same "no questions" error as an empty topic, rather than
    /// silently falling back to the other mode.
    #[test]
    fn next_question_honors_an_explicit_mode_restriction() {
        let conn = setup_conn();
        let topic_id = seed_topic(&conn, "Roztoky", 2); // template only in a closed set
        let student = insert_student(&conn, "student");

        let closed = do_next_question(
            &conn,
            &student,
            &NextQuestionPayload {
                topic_id,
                point_value: 2,
                mode: Some(TemplateMode::Closed),
                set_id: None,
            },
        )
        .expect("closed mode is available");
        assert_eq!(closed.mode, TemplateMode::Closed);

        let open = do_next_question(
            &conn,
            &student,
            &NextQuestionPayload {
                topic_id,
                point_value: 2,
                mode: Some(TemplateMode::Open),
                set_id: None,
            },
        );
        assert!(
            matches!(open, Err(DbError::NotFound(_))),
            "no open-mode question should exist for a template only in a closed set"
        );
    }

    /// A student picking one specific set (sada) must never be served a
    /// question from a sibling set at the same topic/difficulty, even
    /// though both are eligible without the restriction.
    #[test]
    fn next_question_honors_an_explicit_set_restriction() {
        let conn = setup_conn();
        let mut topic = Topic::new("Roztoky".into());
        topic.for_students = true;
        crate::db::repos::TopicRepo::insert(&conn, &topic).expect("insert topic");
        let (_, sets) = CategoryRepo::create(&conn, topic.id, 2).expect("create category");

        let variable = Variable::new("Hmotnost".into(), "X".into(), 1.0, 10.0, 1.0, "g".into(), 0);
        VariableRepo::insert_raw(&conn, &variable).expect("insert variable");

        let make_template = |question_text: &str| {
            let template = Template::new(
                question_text.into(),
                "Y = X * 2".into(),
                "Y = X × 2".into(),
                None,
                "g".into(),
                2,
            );
            let constraint = ResultConstraint::new(
                template.id,
                Some(0.0),
                Some(100.0),
                None,
                ConstraintType::Range,
            );
            let tv = TemplateVariable {
                template_id: template.id,
                variable_id: variable.id,
                placeholder: "X".into(),
                greater_than_variable_id: None,
                less_than_variable_id: None,
            };
            TemplateRepo::insert(&conn, &template, &[tv], &[], Some(&constraint), &[])
                .expect("insert template");
            template.id
        };

        let template_a = make_template("Sada A: kolik je dvojnásobek [[X]] g? [Y]");
        SetRepo::add_template(&conn, &sets[0].id, &template_a).expect("add to set A");
        let template_b = make_template("Sada B: kolik je dvojnásobek [[X]] g? [Y]");
        SetRepo::add_template(&conn, &sets[1].id, &template_b).expect("add to set B");

        let student = insert_student(&conn, "student");

        for _ in 0..15 {
            let question = do_next_question(
                &conn,
                &student,
                &NextQuestionPayload {
                    topic_id: topic.id,
                    point_value: 2,
                    mode: None,
                    set_id: Some(sets[0].id),
                },
            )
            .expect("serve question restricted to set A");
            assert!(
                question.question_text.starts_with("Sada A"),
                "restricting to set A must never serve set B's template, got {:?}",
                question.question_text
            );
        }

        // The topics list must report each set separately, one question
        // apiece, alongside the pooled per-difficulty total.
        let topics = do_list_practice_topics(&conn).expect("list topics");
        let roztoky = topics
            .iter()
            .find(|t| t.name == "Roztoky")
            .expect("Roztoky");
        let difficulty = roztoky
            .difficulties
            .iter()
            .find(|d| d.point_value == 2)
            .expect("2-point difficulty");
        assert_eq!(difficulty.question_count, 2);
        assert_eq!(difficulty.sets.len(), 2);
        assert!(difficulty.sets.iter().all(|s| s.question_count == 1));
    }

    #[test]
    fn unknown_topic_reports_that_there_are_no_questions() {
        let conn = setup_conn();
        let student = insert_student(&conn, "student");

        let result = do_next_question(
            &conn,
            &student,
            &NextQuestionPayload {
                topic_id: Uuid::new_v4(),
                point_value: 2,
                mode: None,
                set_id: None,
            },
        );
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }
}
