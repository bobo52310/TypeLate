use std::time::Duration;
use tauri::command;

const MAX_CONTENT_LENGTH: usize = 5_000_000; // 5 MB
const REQUEST_TIMEOUT_SECS: u64 = 15;
const TEXT_WIDTH: usize = 80;

#[derive(Debug, thiserror::Error)]
pub enum UrlFetchError {
    #[error("Invalid URL: only http:// and https:// are supported")]
    InvalidUrl,
    #[error("Request failed: {0}")]
    RequestFailed(String),
    #[error("Content too large (limit: 5 MB)")]
    ContentTooLarge,
    #[error("Unsupported content type: {0}. Only HTML and plain text are supported.")]
    UnsupportedContentType(String),
    #[error("Failed to extract text: {0}")]
    TextExtractionFailed(String),
}

impl serde::Serialize for UrlFetchError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[command]
pub async fn fetch_url_text(url: String) -> Result<String, UrlFetchError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(UrlFetchError::InvalidUrl);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("TypeLate/1.0")
        .build()
        .map_err(|e| UrlFetchError::RequestFailed(e.to_string()))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| UrlFetchError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        return Err(UrlFetchError::RequestFailed(format!(
            "HTTP {}",
            response.status()
        )));
    }

    // Check content length if available
    if let Some(len) = response.content_length() {
        if len as usize > MAX_CONTENT_LENGTH {
            return Err(UrlFetchError::ContentTooLarge);
        }
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let is_html = content_type.contains("text/html");
    let is_plain = content_type.contains("text/plain");

    if !is_html && !is_plain {
        return Err(UrlFetchError::UnsupportedContentType(
            content_type.to_string(),
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| UrlFetchError::RequestFailed(e.to_string()))?;

    if bytes.len() > MAX_CONTENT_LENGTH {
        return Err(UrlFetchError::ContentTooLarge);
    }

    if is_plain {
        return String::from_utf8(bytes.to_vec())
            .map_err(|e| UrlFetchError::TextExtractionFailed(e.to_string()));
    }

    // HTML → plain text
    html2text::from_read(&bytes[..], TEXT_WIDTH)
        .map_err(|e| UrlFetchError::TextExtractionFailed(e.to_string()))
}
