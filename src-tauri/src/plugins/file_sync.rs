use std::path::Path;
use tauri::command;

/// Read a UTF-8 file at the given path. Returns None if the file does not exist.
#[command]
pub async fn read_sync_file(path: String) -> Result<Option<String>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(None);
    }
    tokio::fs::read_to_string(p)
        .await
        .map(Some)
        .map_err(|e| format!("Failed to read sync file: {}", e))
}

/// Write UTF-8 content to the given path, creating parent directories if needed.
#[command]
pub async fn write_sync_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }
    tokio::fs::write(p, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write sync file: {}", e))
}
