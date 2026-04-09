use arboard::Clipboard;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("Clipboard access failed: {0}")]
    ClipboardAccess(String),
    #[error("Keyboard simulation failed: {0}")]
    KeyboardSimulation(String),
}

impl serde::Serialize for ClipboardError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 透過 CGEvent 模擬 Cmd+V 鍵盤事件來觸發貼上。
///
/// 事件序列：Cmd↓ → V↓ → V↑ → Cmd↑
/// keycodes: Command_L=55, V=9
/// 需要 Accessibility 權限（已有）。
/// 4 事件完整配對，paste 場景下幽靈按鍵風險趨近於零。
#[cfg(target_os = "macos")]
fn simulate_paste_via_cgevent() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEYCODE_COMMAND_L: u16 = 55;
    const KEYCODE_V: u16 = 9;

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    // Cmd ↓
    let cmd_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_COMMAND_L, true)
        .map_err(|_| "Failed to create Cmd down event".to_string())?;
    cmd_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // V ↓ (with Command flag)
    let v_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, true)
        .map_err(|_| "Failed to create V down event".to_string())?;
    v_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // V ↑ (with Command flag)
    let v_up = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, false)
        .map_err(|_| "Failed to create V up event".to_string())?;
    v_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Cmd ↑
    let cmd_up = CGEvent::new_keyboard_event(source, KEYCODE_COMMAND_L, false)
        .map_err(|_| "Failed to create Cmd up event".to_string())?;
    cmd_up.set_flags(CGEventFlags::CGEventFlagNull);

    // Post events in sequence
    cmd_down.post(CGEventTapLocation::HID);
    v_down.post(CGEventTapLocation::HID);
    v_up.post(CGEventTapLocation::HID);
    cmd_up.post(CGEventTapLocation::HID);

    Ok(())
}

/// 透過 SendInput 模擬 Ctrl+V 按鍵來觸發貼上。
///
/// Windows 不像 macOS 有 CGEvent 殘留問題，SendInput 是標準做法。
#[cfg(target_os = "windows")]
fn simulate_paste_via_keyboard() -> Result<(), String> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    unsafe {
        let mut inputs: [INPUT; 4] = mem::zeroed();

        // Ctrl ↓
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki.wVk = VK_CONTROL;

        // V ↓
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki.wVk = VK_V;

        // V ↑
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki.wVk = VK_V;
        inputs[2].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        // Ctrl ↑
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki.wVk = VK_CONTROL;
        inputs[3].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        let sent = SendInput(&inputs, mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(format!("SendInput returned {}, expected 4", sent));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn read_clipboard() -> Result<Option<String>, ClipboardError> {
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    match clipboard.get_text() {
        Ok(text) if !text.is_empty() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), ClipboardError> {
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn paste_text<R: Runtime>(
    _app: AppHandle<R>,
    text: String,
    preserve_clipboard: bool,
) -> Result<(), ClipboardError> {
    #[cfg(debug_assertions)]
    println!(
        "[clipboard-paste] Pasting {} chars: \"{}\"",
        text.len(),
        text
    );
    #[cfg(not(debug_assertions))]
    println!("[clipboard-paste] Pasting {} chars", text.len());

    // 1) 保存原始剪貼簿內容（僅在 preserve_clipboard 模式下）
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    let original_clipboard = if preserve_clipboard {
        let saved = clipboard.get_text().ok();
        println!("[clipboard-paste] Original clipboard saved");
        saved
    } else {
        None
    };

    // 2) 寫入要貼上的文字
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    println!("[clipboard-paste] Text copied to clipboard");

    // 3) 等待剪貼簿同步
    thread::sleep(Duration::from_millis(50));

    // 4) 觸發目標 app 的貼上動作
    #[cfg(target_os = "macos")]
    {
        simulate_paste_via_cgevent().map_err(|e| {
            eprintln!("[clipboard-paste] CGEvent paste failed: {}", e);
            ClipboardError::KeyboardSimulation(e)
        })?;
        println!("[clipboard-paste] Paste triggered via CGEvent (Cmd+V)");
    }

    #[cfg(target_os = "windows")]
    {
        simulate_paste_via_keyboard().map_err(|e| {
            eprintln!("[clipboard-paste] SendInput paste failed: {}", e);
            ClipboardError::KeyboardSimulation(e)
        })?;
        println!("[clipboard-paste] Paste triggered via SendInput (Ctrl+V)");
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        compile_error!("paste_text keyboard simulation is not implemented for this platform");
    }

    // 5) 背景還原原始剪貼簿內容（延遲 500ms 確保目標 app 完成貼上處理）
    if preserve_clipboard {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(500));
            match Clipboard::new() {
                Ok(mut cb) => {
                    if let Some(original) = original_clipboard {
                        if let Err(e) = cb.set_text(&original) {
                            eprintln!("[clipboard-paste] Failed to restore clipboard: {}", e);
                        } else {
                            println!("[clipboard-paste] Original clipboard restored");
                        }
                    } else {
                        // Original clipboard was empty or non-text — clear it
                        // so the transcription text doesn't linger
                        if let Err(e) = cb.clear() {
                            eprintln!("[clipboard-paste] Failed to clear clipboard: {}", e);
                        } else {
                            println!("[clipboard-paste] Clipboard cleared (original was empty/non-text)");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[clipboard-paste] Failed to open clipboard for restore: {}", e);
                }
            }
        });
    }

    println!("[clipboard-paste] Done");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // ClipboardError Display 格式化測試
    // ============================================================

    #[test]
    fn test_clipboard_access_error_display() {
        let error = ClipboardError::ClipboardAccess("permission denied".to_string());
        assert_eq!(
            error.to_string(),
            "Clipboard access failed: permission denied"
        );
    }

    #[test]
    fn test_keyboard_simulation_error_display() {
        let error = ClipboardError::KeyboardSimulation("CGEvent failed".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: CGEvent failed"
        );
    }

    #[test]
    fn test_clipboard_access_error_display_empty_message() {
        let error = ClipboardError::ClipboardAccess(String::new());
        assert_eq!(error.to_string(), "Clipboard access failed: ");
    }

    #[test]
    fn test_keyboard_simulation_error_display_unicode() {
        let error = ClipboardError::KeyboardSimulation("鍵盤模擬失敗".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: 鍵盤模擬失敗"
        );
    }

    // ============================================================
    // ClipboardError Serialize 測試
    // ============================================================

    #[test]
    fn test_clipboard_access_error_serialize() {
        let error = ClipboardError::ClipboardAccess("no clipboard".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "\"Clipboard access failed: no clipboard\"");
    }

    #[test]
    fn test_keyboard_simulation_error_serialize() {
        let error = ClipboardError::KeyboardSimulation("event creation failed".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(
            json,
            "\"Keyboard simulation failed: event creation failed\""
        );
    }

    #[test]
    fn test_error_serialize_roundtrip_is_string() {
        // ClipboardError 序列化後應為純字串，非物件
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let value: serde_json::Value = serde_json::to_value(&error).unwrap();
        assert!(value.is_string(), "序列化結果應為 JSON 字串，非物件");
    }

    // ============================================================
    // ClipboardError Debug trait 測試
    // ============================================================

    #[test]
    fn test_clipboard_error_debug_format() {
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("ClipboardAccess"));
        assert!(debug_str.contains("test"));
    }

    #[test]
    fn test_keyboard_error_debug_format() {
        let error = ClipboardError::KeyboardSimulation("sim fail".to_string());
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("KeyboardSimulation"));
        assert!(debug_str.contains("sim fail"));
    }
}
