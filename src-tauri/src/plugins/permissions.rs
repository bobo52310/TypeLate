//! OS-level permission checks surfaced to the frontend as a unified status model.
//!
//! The frontend renders a "Permissions" settings tab and a first-launch onboarding
//! dialog; both consume these commands to show per-permission status and drive the
//! corresponding "Grant" action.

#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    static AVMediaTypeAudio: *const objc::runtime::Object;
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn mic_authorization_status() -> i64 {
    use objc::runtime::Class;
    unsafe {
        let cls = match Class::get("AVCaptureDevice") {
            Some(c) => c,
            None => return -1,
        };
        msg_send![cls, authorizationStatusForMediaType: AVMediaTypeAudio]
    }
}

fn status_to_string(raw: i64) -> &'static str {
    match raw {
        0 => "notDetermined",
        1 => "restricted",
        2 => "denied",
        3 => "granted",
        _ => "unknown",
    }
}

#[tauri::command]
pub fn check_microphone_permission() -> String {
    #[cfg(target_os = "macos")]
    {
        return status_to_string(mic_authorization_status()).to_string();
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted".to_string()
    }
}

#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Trigger the macOS microphone TCC prompt via
/// `+[AVCaptureDevice requestAccessForMediaType:completionHandler:]`.
///
/// - If status is `notDetermined`, macOS presents the system dialog and
///   invokes the completion block on an arbitrary thread once the user
///   answers. We ignore the result — the frontend polls `check_microphone_permission`
///   to pick up the new status.
/// - If status is `denied` or `restricted`, `requestAccess` does NOT re-prompt;
///   the caller should open System Settings instead.
/// - If already `granted`, this is a no-op.
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn trigger_mic_permission_prompt() {
    use block::ConcreteBlock;
    use objc::runtime::{Class, BOOL};
    unsafe {
        let cls = match Class::get("AVCaptureDevice") {
            Some(c) => c,
            None => return,
        };
        // Fire-and-forget completion handler; frontend polls for the result.
        let block = ConcreteBlock::new(|_granted: BOOL| {});
        let block = block.copy();
        let _: () = msg_send![
            cls,
            requestAccessForMediaType: AVMediaTypeAudio
            completionHandler: &*block
        ];
    }
}

#[tauri::command]
pub fn request_microphone_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let status = mic_authorization_status();
        if status == 0 {
            trigger_mic_permission_prompt();
        }
        return Ok(status_to_string(mic_authorization_status()).to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("granted".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_to_string_mapping() {
        assert_eq!(status_to_string(0), "notDetermined");
        assert_eq!(status_to_string(1), "restricted");
        assert_eq!(status_to_string(2), "denied");
        assert_eq!(status_to_string(3), "granted");
        assert_eq!(status_to_string(42), "unknown");
    }
}
