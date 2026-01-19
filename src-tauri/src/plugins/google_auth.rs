use std::sync::Arc;
use tauri::{command, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

/// State shared between start_oauth_listener and await_oauth_code
pub struct OAuthListenerState {
    /// Stores the auth code once received
    code: Arc<Mutex<Option<String>>>,
    /// Notify channel to signal code received
    notify: Arc<Notify>,
}

impl OAuthListenerState {
    pub fn new() -> Self {
        Self {
            code: Arc::new(Mutex::new(None)),
            notify: Arc::new(Notify::new()),
        }
    }
}

/// Start a local TCP listener on a random port for OAuth redirect.
/// Returns the port number. The listener accepts one connection,
/// extracts the `code` query parameter, and sends a success HTML response.
#[command]
pub async fn start_oauth_listener(
    state: State<'_, OAuthListenerState>,
) -> Result<u16, String> {
    // Bind to a random available port
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind TCP listener: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?
        .port();

    // Reset any previous code
    {
        let mut code_lock: tokio::sync::MutexGuard<'_, Option<String>> =
            state.code.lock().await;
        *code_lock = None;
    }

    let code_store: Arc<Mutex<Option<String>>> = Arc::clone(&state.code);
    let notify: Arc<Notify> = Arc::clone(&state.notify);

    // Spawn a task to handle the single incoming connection
    tokio::spawn(async move {
        // Set a timeout of 120 seconds for the OAuth flow
        let accept_result = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            listener.accept(),
        )
        .await;

        let (mut stream, _addr) = match accept_result {
            Ok(Ok(conn)) => conn,
            Ok(Err(e)) => {
                eprintln!("[google_auth] Accept failed: {e}");
                notify.notify_one();
                return;
            }
            Err(_) => {
                eprintln!("[google_auth] OAuth listener timed out after 120s");
                notify.notify_one();
                return;
            }
        };

        // Read the HTTP request
        let mut buf = vec![0u8; 4096];
        let n: usize = match stream.read(&mut buf).await {
            Ok(n) => n,
            Err(e) => {
                eprintln!("[google_auth] Read failed: {e}");
                notify.notify_one();
                return;
            }
        };

        let request = String::from_utf8_lossy(&buf[..n]);

        // Extract the authorization code from the query string
        let auth_code: Option<String> = extract_code_from_request(&request);

        // Send HTML response
        let (status, body): (&str, &str) = if auth_code.is_some() {
            ("200 OK", include_str!("../assets/oauth_success.html"))
        } else {
            ("400 Bad Request", "<html><body><h1>Authorization failed</h1><p>No authorization code received. Please try again.</p></body></html>")
        };

        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n{body}"
        );

        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.flush().await;

        // Store the code
        if let Some(code) = auth_code {
            let mut code_lock: tokio::sync::MutexGuard<'_, Option<String>> =
                code_store.lock().await;
            *code_lock = Some(code);
        }

        notify.notify_one();
    });

    Ok(port)
}

/// Wait for the OAuth authorization code. Blocks until the listener receives
/// a redirect with a code parameter, or times out.
#[command]
pub async fn await_oauth_code(
    state: State<'_, OAuthListenerState>,
) -> Result<String, String> {
    let notify: Arc<Notify> = Arc::clone(&state.notify);

    // Wait for the notification with a timeout
    let wait_result = tokio::time::timeout(
        std::time::Duration::from_secs(130),
        notify.notified(),
    )
    .await;

    if wait_result.is_err() {
        return Err("OAuth flow timed out".to_string());
    }

    let code_lock: tokio::sync::MutexGuard<'_, Option<String>> =
        state.code.lock().await;
    match code_lock.as_ref() {
        Some(code) => Ok(code.clone()),
        None => Err("No authorization code received".to_string()),
    }
}

/// Extract the `code` query parameter from an HTTP GET request line
fn extract_code_from_request(request: &str) -> Option<String> {
    let first_line = request.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;

    for param in query.split('&') {
        let mut parts = param.splitn(2, '=');
        let key = parts.next()?;
        let value = parts.next().unwrap_or("");
        if key == "code" {
            return Some(url_decode(value));
        }
    }

    None
}

/// Basic URL decoding for the auth code
fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}
