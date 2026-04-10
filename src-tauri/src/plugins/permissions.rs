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

/// Trigger the macOS microphone TCC prompt by briefly attempting to open a
/// cpal input stream on a background thread.
///
/// - If status is `notDetermined`, macOS shows the system dialog and returns
///   the resulting status once the user answers (best-effort; we poll briefly).
/// - If status is `denied` or `restricted`, we cannot re-prompt; the caller
///   should open System Settings instead.
/// - If already `granted`, this is a no-op.
#[tauri::command]
pub fn request_microphone_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let status = mic_authorization_status();
        if status == 0 {
            std::thread::spawn(|| {
                use cpal::traits::{DeviceTrait, HostTrait};
                let host = cpal::default_host();
                if let Some(device) = host.default_input_device() {
                    if let Ok(supported) = device.default_input_config() {
                        let config: cpal::StreamConfig = supported.clone().into();
                        // Drop immediately — the act of building a stream triggers
                        // the TCC prompt on macOS; we don't need audio samples.
                        match supported.sample_format() {
                            cpal::SampleFormat::F32 => {
                                let _ = device.build_input_stream::<f32, _, _>(
                                    &config,
                                    |_data, _| {},
                                    |_err| {},
                                    None,
                                );
                            }
                            cpal::SampleFormat::I16 => {
                                let _ = device.build_input_stream::<i16, _, _>(
                                    &config,
                                    |_data, _| {},
                                    |_err| {},
                                    None,
                                );
                            }
                            cpal::SampleFormat::U16 => {
                                let _ = device.build_input_stream::<u16, _, _>(
                                    &config,
                                    |_data, _| {},
                                    |_err| {},
                                    None,
                                );
                            }
                            _ => {}
                        }
                    }
                }
            });
            // Give macOS a moment to present the dialog, then re-read status.
            // The user may still be deciding — frontend will keep polling.
            std::thread::sleep(std::time::Duration::from_millis(400));
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
