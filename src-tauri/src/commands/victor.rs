use crate::db::repos::AppSettingsRepo;
use crate::db::{AppState, DbError};
use serde::{Deserialize, Serialize};
use tauri::State;

const KEY_API_BASE_URL: &str = "victor_api_base_url";
const KEY_API_KEY: &str = "victor_api_key";

const DEFAULT_API_BASE_URL: &str = "https://api.moonshot.cn/v1/chat/completions";
const DEFAULT_API_KEY: &str = "";

const LLM_TIMEOUT_SECS: u64 = 60;

const SYSTEM_PROMPT: &str = "You are Victor, an expert biochemistry teaching assistant. \
You help students solve biochemistry problems step by step. \
Always explain your reasoning clearly, show calculations methodically, \
and provide practical biochemistry context. \
Respond ONLY with valid JSON — no markdown, no extra commentary outside the JSON object.";

const USER_PROMPT_SUFFIX: &str = "\n\nRespond with a JSON object containing these fields:\n\
- \"calculation\": step-by-step calculation as a string\n\
- \"solution\": the final numeric answer as a string (include units)\n\
- \"explanation\": practical biochemistry context and explanation\n\
- \"variables\": array of recognized variables, each with \"symbol\" (string), \"value\" (number), and \"unit\" (string)";

/// Victor AI assistant settings returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VictorSettings {
    pub api_base_url: String,
    pub api_key: String,
}

/// Payload for updating Victor settings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VictorSettingsPayload {
    pub api_base_url: String,
    pub api_key: String,
}

/// A single message in the Victor chat history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VictorMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

/// Payload received from the frontend when the user sends a chat message.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VictorChatPayload {
    pub question: String,
    pub history: Vec<VictorMessage>,
}

/// A recognized variable in the AI response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VictorVariable {
    pub symbol: String,
    pub value: f64,
    pub unit: String,
}

/// Structured response returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VictorResponse {
    pub calculation: String,
    pub solution: String,
    pub explanation: String,
    pub variables: Vec<VictorVariable>,
}

#[derive(Debug, Serialize)]
struct LlmMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct LlmRequest {
    messages: Vec<LlmMessage>,
}

#[derive(Debug, Deserialize)]
struct LlmChoice {
    message: LlmChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct LlmChoiceMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct LlmResponseBody {
    choices: Vec<LlmChoice>,
}

/// Strip markdown code fences from a string.
/// Handles ```json ... ```, ``` ... ```, and variations with optional language tags.
fn strip_markdown_fences(raw: &str) -> &str {
    let trimmed = raw.trim();

    let after_open = if let Some(rest) = trimmed
        .strip_prefix("```json\n")
        .or_else(|| trimmed.strip_prefix("```json\r\n"))
        .or_else(|| trimmed.strip_prefix("```\n"))
        .or_else(|| trimmed.strip_prefix("```\r\n"))
        .or_else(|| trimmed.strip_prefix("```json"))
        .or_else(|| trimmed.strip_prefix("```"))
    {
        rest
    } else {
        return trimmed;
    };

    after_open
        .strip_suffix("\n```")
        .or_else(|| after_open.strip_suffix("\r\n```"))
        .or_else(|| after_open.strip_suffix("```"))
        .unwrap_or(after_open)
        .trim()
}

fn build_system_message() -> LlmMessage {
    LlmMessage {
        role: "system".to_string(),
        content: SYSTEM_PROMPT.to_string(),
    }
}

fn build_user_message(question: &str) -> LlmMessage {
    LlmMessage {
        role: "user".to_string(),
        content: format!("{}{}", question, USER_PROMPT_SUFFIX),
    }
}

fn build_llm_request(question: &str, history: &[VictorMessage]) -> LlmRequest {
    let mut messages = Vec::with_capacity(1 + history.len() + 1);
    messages.push(build_system_message());
    for msg in history {
        messages.push(LlmMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
        });
    }
    messages.push(build_user_message(question));
    LlmRequest { messages }
}

fn parse_victor_response(raw_content: &str) -> Result<VictorResponse, DbError> {
    let cleaned = strip_markdown_fences(raw_content);
    serde_json::from_str::<VictorResponse>(cleaned).map_err(|e| {
        DbError::Validation(format!(
            "Failed to parse AI response as VictorResponse: {}. Raw content: {}",
            e,
            &cleaned[..cleaned.len().min(200)]
        ))
    })
}

#[tauri::command]
pub fn get_victor_settings(state: State<'_, AppState>) -> Result<VictorSettings, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    let api_base_url =
        AppSettingsRepo::get_or_default(&conn, KEY_API_BASE_URL, DEFAULT_API_BASE_URL)?;
    let api_key = AppSettingsRepo::get_or_default(&conn, KEY_API_KEY, DEFAULT_API_KEY)?;
    Ok(VictorSettings {
        api_base_url,
        api_key,
    })
}

#[tauri::command]
pub fn set_victor_settings(
    state: State<'_, AppState>,
    payload: VictorSettingsPayload,
) -> Result<VictorSettings, DbError> {
    let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
    AppSettingsRepo::set(&conn, KEY_API_BASE_URL, &payload.api_base_url)?;
    AppSettingsRepo::set(&conn, KEY_API_KEY, &payload.api_key)?;
    Ok(VictorSettings {
        api_base_url: payload.api_base_url,
        api_key: payload.api_key,
    })
}

#[tauri::command]
pub async fn chat_with_victor(
    state: State<'_, AppState>,
    payload: VictorChatPayload,
) -> Result<VictorResponse, DbError> {
    let (api_base_url, api_key) = {
        let conn = state.db.lock().map_err(|e| DbError::Io(e.to_string()))?;
        let url = AppSettingsRepo::get_or_default(&conn, KEY_API_BASE_URL, DEFAULT_API_BASE_URL)?;
        let key = AppSettingsRepo::get_or_default(&conn, KEY_API_KEY, DEFAULT_API_KEY)?;
        (url, key)
    };

    let request_body = build_llm_request(&payload.question, &payload.history);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(LLM_TIMEOUT_SECS))
        .build()
        .map_err(|e| DbError::Io(format!("Failed to create HTTP client: {e}")))?;

    let mut req_builder = client
        .post(&api_base_url)
        .header("Content-Type", "application/json");

    if !api_key.is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = req_builder
        .json(&request_body)
        .send()
        .await
        .map_err(|e| DbError::Io(format!("LLM API request failed: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(DbError::Io(format!(
            "LLM API returned status {}: {}",
            status.as_u16(),
            &error_text[..error_text.len().min(500)]
        )));
    }

    let body: LlmResponseBody = response
        .json()
        .await
        .map_err(|e| DbError::Validation(format!("Failed to parse LLM API response body: {e}")))?;

    let content = body
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default();

    parse_victor_response(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_json_response() {
        let json = r#"{
            "calculation": "Step 1: ...\nStep 2: ...",
            "solution": "7.4",
            "explanation": "The pH of blood is tightly regulated.",
            "variables": [
                {"symbol": "pH", "value": 7.4, "unit": ""},
                {"symbol": "pCO2", "value": 40.0, "unit": "mmHg"}
            ]
        }"#;
        let result = parse_victor_response(json).expect("should parse");
        assert_eq!(result.solution, "7.4");
        assert_eq!(result.calculation, "Step 1: ...\nStep 2: ...");
        assert_eq!(result.explanation, "The pH of blood is tightly regulated.");
        assert_eq!(result.variables.len(), 2);
        assert_eq!(result.variables[0].symbol, "pH");
        assert_eq!(result.variables[0].value, 7.4);
        assert_eq!(result.variables[0].unit, "");
        assert_eq!(result.variables[1].symbol, "pCO2");
        assert_eq!(result.variables[1].value, 40.0);
        assert_eq!(result.variables[1].unit, "mmHg");
    }

    #[test]
    fn strip_markdown_fences_before_parse() {
        let raw = "```json\n{\n  \"calculation\": \"...\",\n  \"solution\": \"42\",\n  \"explanation\": \"...\",\n  \"variables\": []\n}\n```";
        let result = parse_victor_response(raw).expect("should strip fences and parse");
        assert_eq!(result.solution, "42");
    }

    #[test]
    fn strip_markdown_fences_no_language_tag() {
        let raw = "```\n{\"calculation\":\"c\",\"solution\":\"1\",\"explanation\":\"e\",\"variables\":[]}\n```";
        let result = parse_victor_response(raw).expect("should strip fences without language tag");
        assert_eq!(result.solution, "1");
    }

    #[test]
    fn strip_markdown_fences_no_newline_after_tag() {
        let raw = "```json{\"calculation\":\"c\",\"solution\":\"2\",\"explanation\":\"e\",\"variables\":[]}```";
        let cleaned = strip_markdown_fences(raw);
        assert!(!cleaned.starts_with("```"));
        assert!(!cleaned.ends_with("```"));
    }

    #[test]
    fn return_error_for_malformed_json() {
        let bad = "not json at all";
        let result = parse_victor_response(bad);
        assert!(result.is_err());
        let err = result.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Failed to parse AI response"));
    }

    #[test]
    fn return_error_for_json_with_wrong_shape() {
        let wrong_shape = r#"{"foo": "bar"}"#;
        let result = parse_victor_response(wrong_shape);
        assert!(result.is_err());
    }

    #[test]
    fn prompt_construction_includes_question() {
        let question = "What is the pH of a 0.1 M HCl solution?";
        let history: Vec<VictorMessage> = vec![];
        let request = build_llm_request(question, &history);

        assert_eq!(request.messages.len(), 2);
        assert_eq!(request.messages[0].role, "system");
        assert!(request.messages[0].content.contains("Victor"));
        assert!(request.messages[0].content.contains("biochemistry"));

        assert_eq!(request.messages[1].role, "user");
        assert!(request.messages[1].content.contains(question));
        assert!(request.messages[1].content.contains("calculation"));
        assert!(request.messages[1].content.contains("solution"));
        assert!(request.messages[1].content.contains("explanation"));
        assert!(request.messages[1].content.contains("variables"));
    }

    #[test]
    fn prompt_includes_history_when_present() {
        let question = "Second question";
        let history = vec![
            VictorMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "First question".to_string(),
                timestamp: "2024-01-01T00:00:00Z".to_string(),
            },
            VictorMessage {
                id: "2".to_string(),
                role: "assistant".to_string(),
                content: "First answer".to_string(),
                timestamp: "2024-01-01T00:00:01Z".to_string(),
            },
        ];
        let request = build_llm_request(question, &history);

        assert_eq!(request.messages.len(), 4);
        assert_eq!(request.messages[1].role, "user");
        assert_eq!(request.messages[1].content, "First question");
        assert_eq!(request.messages[2].role, "assistant");
        assert_eq!(request.messages[2].content, "First answer");
    }

    #[test]
    fn parse_response_camelcase_json() {
        let json = r#"{
            "calculation": "c",
            "solution": "s",
            "explanation": "e",
            "variables": [{"symbol": "x", "value": 1.0, "unit": "m"}]
        }"#;
        let result = parse_victor_response(json).expect("should parse camelCase");
        assert_eq!(result.calculation, "c");
        assert_eq!(result.solution, "s");
        assert_eq!(result.explanation, "e");
        assert_eq!(result.variables[0].symbol, "x");
        assert_eq!(result.variables[0].value, 1.0);
        assert_eq!(result.variables[0].unit, "m");
    }

    #[test]
    fn empty_content_yields_parse_error() {
        let result = parse_victor_response("");
        assert!(result.is_err());
    }

    #[test]
    fn strip_simple_fence_no_newline() {
        assert_eq!(strip_markdown_fences("```hello```"), "hello");
    }

    #[test]
    fn strip_content_without_fences_is_unchanged() {
        let content = r#"{"calculation":"c","solution":"s","explanation":"e","variables":[]}"#;
        assert_eq!(strip_markdown_fences(content), content);
    }
}
