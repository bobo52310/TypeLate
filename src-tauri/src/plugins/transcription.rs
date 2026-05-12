use std::time::Instant;

use tauri::{command, State};

// ========== Constants ==========

const MAX_WHISPER_PROMPT_TERMS: usize = 50;
// Groq Whisper rejects prompts whose length exceeds 896 "characters" with
// HTTP 400 invalid_request_error. Empirically Groq counts UTF-8 bytes
// (an 880-codepoint prompt with mixed CJK + ASCII still got rejected at
// "1020 characters"), so we bound by byte length — the strictest unit that
// is ≥ both Unicode code points and UTF-16 code units.
const GROQ_PROMPT_BUDGET_BYTES: usize = 880;
// OpenAI Whisper's prompt is bounded by Whisper's 224-token encoder context
// (silently truncated on overflow, not rejected). With CJK BPE one char can
// expand to ~2 tokens, so cap at 200 chars to keep headroom across languages.
const OPENAI_PROMPT_BUDGET_CHARS: usize = 200;
const MINIMUM_AUDIO_SIZE: usize = 1000;
const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
const REQUEST_TIMEOUT_SECS: u64 = 30;

// ========== State ==========

pub struct TranscriptionState {
    client: reqwest::Client,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .expect("Failed to build HTTP client");
        Self { client }
    }
}

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("Audio data too small ({0} bytes), recording may have failed")]
    AudioTooSmall(usize),
    #[error("API key is missing")]
    ApiKeyMissing,
    #[error("API request failed: {0}")]
    RequestFailed(String),
    #[error("API returned error ({0}): {1}")]
    ApiError(u16, String),
    #[error("Failed to parse API response: {0}")]
    ParseError(String),
}

impl serde::Serialize for TranscriptionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========== Result Types ==========

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitInfo {
    pub limit_requests: Option<u64>,
    pub remaining_requests: Option<u64>,
    pub limit_tokens: Option<u64>,
    pub remaining_tokens: Option<u64>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub transcription_duration_ms: f64,
    pub no_speech_probability: f64,
    pub rate_limit: Option<RateLimitInfo>,
}

// ========== Groq API Response ==========

#[derive(serde::Deserialize)]
struct WhisperVerboseResponse {
    text: String,
    segments: Vec<WhisperSegment>,
}

#[derive(serde::Deserialize)]
struct WhisperSegment {
    no_speech_prob: f64,
}

// ========== Helpers ==========

fn header_as_u64(response: &reqwest::Response, name: &str) -> Option<u64> {
    response
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn extract_rate_limit_headers(response: &reqwest::Response) -> Option<RateLimitInfo> {
    let info = RateLimitInfo {
        limit_requests: header_as_u64(response, "x-ratelimit-limit-requests"),
        remaining_requests: header_as_u64(response, "x-ratelimit-remaining-requests"),
        limit_tokens: header_as_u64(response, "x-ratelimit-limit-tokens"),
        remaining_tokens: header_as_u64(response, "x-ratelimit-remaining-tokens"),
    };
    // Only return Some if at least one field is present
    if info.limit_requests.is_some()
        || info.remaining_requests.is_some()
        || info.limit_tokens.is_some()
        || info.remaining_tokens.is_some()
    {
        Some(info)
    } else {
        None
    }
}

#[derive(Clone, Copy)]
struct PromptBudget {
    max_bytes: usize,
    max_chars: usize,
}

/// Pick the prompt-length budget for a given transcription endpoint.
/// Different providers measure "prompt length" differently:
/// - Groq: UTF-8 bytes against a 896-byte ceiling (hard 400 on overflow)
/// - OpenAI: Whisper encoder context = 224 tokens (silent truncation)
/// Unknown providers get the strictest combination.
fn prompt_budget_for_url(api_url: &str) -> PromptBudget {
    if api_url.contains("openai.com") {
        PromptBudget {
            max_bytes: usize::MAX,
            max_chars: OPENAI_PROMPT_BUDGET_CHARS,
        }
    } else if api_url.contains("groq.com") {
        PromptBudget {
            max_bytes: GROQ_PROMPT_BUDGET_BYTES,
            max_chars: usize::MAX,
        }
    } else {
        // Unknown / future provider: apply both caps for safety.
        PromptBudget {
            max_bytes: GROQ_PROMPT_BUDGET_BYTES,
            max_chars: OPENAI_PROMPT_BUDGET_CHARS,
        }
    }
}

fn format_whisper_prompt(term_list: &[String], api_url: &str) -> String {
    const PREFIX: &str = "Important Vocabulary: ";
    const SEPARATOR: &str = ", ";
    let separator_bytes = SEPARATOR.len();
    let separator_chars = SEPARATOR.chars().count();
    let budget = prompt_budget_for_url(api_url);

    let mut out = String::from(PREFIX);
    let mut current_bytes = PREFIX.len();
    let mut current_chars = PREFIX.chars().count();
    let mut first = true;

    for term in term_list.iter().take(MAX_WHISPER_PROMPT_TERMS) {
        let term_bytes = term.len();
        let term_chars = term.chars().count();
        let needed_bytes = if first { term_bytes } else { separator_bytes + term_bytes };
        let needed_chars = if first { term_chars } else { separator_chars + term_chars };
        if current_bytes + needed_bytes > budget.max_bytes
            || current_chars + needed_chars > budget.max_chars
        {
            break;
        }
        if !first {
            out.push_str(SEPARATOR);
        }
        out.push_str(term);
        current_bytes += needed_bytes;
        current_chars += needed_chars;
        first = false;
    }

    out
}

// ========== Shared Transcription Logic ==========

async fn send_transcription_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    api_url: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if wav_data.len() < MINIMUM_AUDIO_SIZE {
        return Err(TranscriptionError::AudioTooSmall(wav_data.len()));
    }

    let model = model_id.unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    println!(
        "[transcription] Sending {} bytes WAV to {} (model={})",
        wav_data.len(),
        api_url,
        model
    );

    let start_time = Instant::now();

    // Build multipart form
    let file_part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model)
        .text("response_format", "verbose_json");

    // Conditionally add language — None means auto-detect
    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    if let Some(ref terms) = vocabulary_term_list {
        if !terms.is_empty() {
            let prompt = format_whisper_prompt(terms, &api_url);
            println!(
                "[transcription] Whisper prompt: chars={}, bytes={}, term_count={}",
                prompt.chars().count(),
                prompt.len(),
                terms.len()
            );
            form = form.text("prompt", prompt);
        }
    }

    // Send request (reuse shared client for connection pooling)
    let response = transcription_state
        .client
        .post(&api_url)
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        return Err(TranscriptionError::ApiError(status, body));
    }

    // Extract rate limit headers before consuming the response body
    let rate_limit = extract_rate_limit_headers(&response);

    // Parse response
    let json: WhisperVerboseResponse = response
        .json()
        .await
        .map_err(|e| TranscriptionError::ParseError(e.to_string()))?;

    let raw_text = json.text.trim().to_string();
    // Use MIN: if any segment detects speech (low NSP), trust it — real speech
    // always produces at least one low-NSP segment, while pure noise/hallucination
    // keeps all segments high.
    let no_speech_probability = json
        .segments
        .iter()
        .map(|s| s.no_speech_prob)
        .fold(1.0_f64, f64::min);
    // If no segments, treat as full silence
    let no_speech_probability = if json.segments.is_empty() {
        1.0
    } else {
        no_speech_probability
    };

    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;

    println!(
        "[transcription] Response in {:.0}ms: \"{}\" (noSpeechProb={:.3})",
        transcription_duration_ms, raw_text, no_speech_probability
    );

    Ok(TranscriptionResult {
        raw_text,
        transcription_duration_ms,
        no_speech_probability,
        rate_limit,
    })
}

// ========== Commands ==========

#[command]
pub async fn transcribe_audio(
    transcription_state: State<'_, TranscriptionState>,
    wav_data: Vec<u8>,
    api_url: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    send_transcription_request(
        wav_data,
        &transcription_state,
        api_url,
        api_key,
        vocabulary_term_list,
        model_id,
        language,
    )
    .await
}

#[command]
pub async fn retranscribe_from_file(
    transcription_state: State<'_, TranscriptionState>,
    file_path: String,
    api_url: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    // 注意：std::fs::read 是同步 I/O，但 WAV 檔案通常很小（< 1MB），
    // 在 Tauri command 的 async context 中可接受。
    let wav_data = std::fs::read(&file_path).map_err(|e| {
        TranscriptionError::RequestFailed(format!("Failed to read WAV file: {}", e))
    })?;

    println!(
        "[transcription] Retranscribing from file: {} ({} bytes)",
        file_path,
        wav_data.len()
    );

    send_transcription_request(
        wav_data,
        &transcription_state,
        api_url,
        api_key,
        vocabulary_term_list,
        model_id,
        language,
    )
    .await
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    const GROQ_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
    const OPENAI_URL: &str = "https://api.openai.com/v1/audio/transcriptions";

    #[test]
    fn test_format_whisper_prompt_basic() {
        let terms = vec!["Tauri".to_string(), "Rust".to_string(), "Vue".to_string()];
        let result = format_whisper_prompt(&terms, GROQ_URL);
        assert_eq!(result, "Important Vocabulary: Tauri, Rust, Vue");
    }

    #[test]
    fn test_format_whisper_prompt_empty() {
        let terms: Vec<String> = vec![];
        let result = format_whisper_prompt(&terms, GROQ_URL);
        assert_eq!(result, "Important Vocabulary: ");
    }

    #[test]
    fn test_format_whisper_prompt_groq_term_count_cap() {
        let terms: Vec<String> = (0..100).map(|i| format!("term{}", i)).collect();
        let result = format_whisper_prompt(&terms, GROQ_URL);
        let parts: Vec<&str> = result
            .strip_prefix("Important Vocabulary: ")
            .unwrap()
            .split(", ")
            .collect();
        // Short ascii terms fit under both byte/char budgets, so the
        // term-count cap (50) is what kicks in for Groq.
        assert_eq!(parts.len(), MAX_WHISPER_PROMPT_TERMS);
        assert_eq!(parts[0], "term0");
        assert_eq!(parts[MAX_WHISPER_PROMPT_TERMS - 1], "term49");
    }

    #[test]
    fn test_format_whisper_prompt_groq_byte_budget_ascii() {
        // 50 terms × 30 ascii chars + 49 separators (2 bytes) + prefix (22 bytes)
        // = 1620 bytes, well above GROQ_PROMPT_BUDGET_BYTES (880).
        let terms: Vec<String> = (0..50).map(|i| format!("{:0>30}", i)).collect();
        let result = format_whisper_prompt(&terms, GROQ_URL);
        assert!(
            result.len() <= GROQ_PROMPT_BUDGET_BYTES,
            "expected ≤{} bytes, got {}",
            GROQ_PROMPT_BUDGET_BYTES,
            result.len()
        );
        // At least the first term must always fit (otherwise vocabulary is unusable).
        assert!(result.contains(&terms[0]));
    }

    #[test]
    fn test_format_whisper_prompt_groq_byte_budget_cjk() {
        // 10 CJK chars per term = 30 bytes each + 2-byte separator. With 50
        // terms we'd hit 30*50 + 2*49 + 22 = 1620 bytes, way over budget.
        let terms: Vec<String> = (0..MAX_WHISPER_PROMPT_TERMS)
            .map(|_| "詞彙術語語詞語詞語詞".to_string())
            .collect();
        let result = format_whisper_prompt(&terms, GROQ_URL);
        assert!(
            result.len() <= GROQ_PROMPT_BUDGET_BYTES,
            "expected ≤{} bytes, got {}",
            GROQ_PROMPT_BUDGET_BYTES,
            result.len()
        );
    }

    #[test]
    fn test_format_whisper_prompt_openai_char_budget_cjk() {
        // OpenAI Whisper caps at 224 tokens. We use char count as proxy
        // (≤200 chars). 50 × 10 CJK chars = 500 chars, well over the limit.
        let terms: Vec<String> = (0..MAX_WHISPER_PROMPT_TERMS)
            .map(|_| "詞彙術語語詞語詞語詞".to_string())
            .collect();
        let result = format_whisper_prompt(&terms, OPENAI_URL);
        assert!(
            result.chars().count() <= OPENAI_PROMPT_BUDGET_CHARS,
            "expected ≤{} chars, got {}",
            OPENAI_PROMPT_BUDGET_CHARS,
            result.chars().count()
        );
    }

    #[test]
    fn test_format_whisper_prompt_openai_keeps_high_weight_first() {
        // Greedy packing must preserve weight order (term_list is already
        // weight-sorted at the call site). First term must always survive.
        let terms: Vec<String> = (0..50).map(|i| format!("term-{:03}", i)).collect();
        let result = format_whisper_prompt(&terms, OPENAI_URL);
        assert!(result.starts_with("Important Vocabulary: term-000, "));
        assert!(result.chars().count() <= OPENAI_PROMPT_BUDGET_CHARS);
    }

    #[test]
    fn test_format_whisper_prompt_unknown_provider_applies_both_caps() {
        // Defensive: an unknown URL should clamp by *both* budgets so we
        // never accidentally over-send to a future provider.
        let terms: Vec<String> = (0..50)
            .map(|_| "詞彙術語語詞語詞語詞".to_string())
            .collect();
        let result = format_whisper_prompt(&terms, "https://example.com/transcribe");
        assert!(result.len() <= GROQ_PROMPT_BUDGET_BYTES);
        assert!(result.chars().count() <= OPENAI_PROMPT_BUDGET_CHARS);
    }

    #[test]
    fn test_transcription_result_serialization() {
        let result = TranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: 0.01,
            rate_limit: Some(RateLimitInfo {
                limit_requests: Some(2000),
                remaining_requests: Some(1999),
                limit_tokens: None,
                remaining_tokens: None,
            }),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rawText\""));
        assert!(json.contains("\"transcriptionDurationMs\""));
        assert!(json.contains("\"noSpeechProbability\""));
        assert!(json.contains("\"rateLimit\""));
        assert!(json.contains("\"remainingRequests\":1999"));
    }
}
