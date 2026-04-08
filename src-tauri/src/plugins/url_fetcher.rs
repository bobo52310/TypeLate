use regex::Regex;
use std::time::Duration;
use tauri::command;

const MAX_CONTENT_LENGTH: usize = 5_000_000; // 5 MB
const MAX_EXTRACTED_TEXT_CHARS: usize = 30_000; // cap returned text
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

/// Extract article content from HTML, stripping navigation noise.
/// Priority: `<article>` → `<main>` → full page minus nav/footer/header/aside.
fn extract_content_html(html: &str) -> String {
    // Try <article> first — most semantic HTML pages wrap content here
    let article_re = Regex::new(r"(?is)<article\b[^>]*>(.*?)</article>").unwrap();
    let articles: Vec<&str> = article_re
        .captures_iter(html)
        .map(|c| c.get(1).unwrap().as_str())
        .collect();
    if !articles.is_empty() {
        return articles.join("\n\n");
    }

    // Try <main>
    let main_re = Regex::new(r"(?is)<main\b[^>]*>(.*?)</main>").unwrap();
    if let Some(cap) = main_re.captures(html) {
        return cap[1].to_string();
    }

    // Fallback: strip noise elements
    let noise_re =
        Regex::new(r"(?is)<(nav|footer|header|aside)\b[^>]*>.*?</\1>").unwrap();
    noise_re.replace_all(html, "").to_string()
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

    let text = if is_plain {
        String::from_utf8(bytes.to_vec())
            .map_err(|e| UrlFetchError::TextExtractionFailed(e.to_string()))?
    } else {
        // HTML → extract article content → plain text
        let html = String::from_utf8(bytes.to_vec())
            .map_err(|e| UrlFetchError::TextExtractionFailed(e.to_string()))?;
        let content_html = extract_content_html(&html);
        html2text::from_read(content_html.as_bytes(), TEXT_WIDTH)
            .map_err(|e| UrlFetchError::TextExtractionFailed(e.to_string()))?
    };

    // Cap text length to avoid oversized IPC payloads
    if text.chars().count() > MAX_EXTRACTED_TEXT_CHARS {
        Ok(text.chars().take(MAX_EXTRACTED_TEXT_CHARS).collect())
    } else {
        Ok(text)
    }
}
