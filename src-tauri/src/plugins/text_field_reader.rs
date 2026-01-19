/// 取得最前方應用程式的 bundle identifier。
/// macOS: 透過 NSWorkspace.sharedWorkspace.frontmostApplication
/// 其他平台: 回傳 None
#[tauri::command]
pub fn get_frontmost_app_bundle_id() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_frontmost_app_bundle_id_impl()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

/// 最前方應用程式的資訊（名稱 + bundle ID + icon base64 PNG）
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrontmostAppInfo {
    pub name: String,
    pub bundle_id: String,
    pub icon_base64: String,
}

/// 取得最前方應用程式的名稱、bundle ID 和圖示。
/// macOS: 透過 NSWorkspace + NSRunningApplication
/// 其他平台: 回傳 None
#[tauri::command]
pub fn get_frontmost_app_info() -> Result<Option<FrontmostAppInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_frontmost_app_info_impl()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

/// 讀取當前 focused text field 游標附近的文字。
/// macOS: 透過 AXUIElement Accessibility API
/// Windows: 目前為 no-op placeholder（後續補上 UI Automation）
#[tauri::command]
pub fn read_focused_text_field() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::read_focused_text_field_impl()
    }

    #[cfg(target_os = "windows")]
    {
        // Windows UI Automation 實作延後，先回傳 None
        Ok(None)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

// ========== macOS: AXUIElement ==========

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::os::raw::c_int;

    type AXUIElementRef = CFTypeRef;
    type AXError = c_int;

    const K_AX_ERROR_SUCCESS: AXError = 0;

    // AX attribute name constants
    const K_AX_FOCUSED_APPLICATION_ATTRIBUTE: &str = "AXFocusedApplication";
    const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE: &str = "AXFocusedUIElement";
    const K_AX_VALUE_ATTRIBUTE: &str = "AXValue";
    const K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE: &str = "AXSelectedTextRange";
    const K_AX_ROLE_ATTRIBUTE: &str = "AXRole";

    const CONTEXT_CHARS: usize = 50;
    const FALLBACK_CHARS: usize = 100;

    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
    }

    // CFRange struct for AXValue extraction
    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct CFRange {
        location: i64,
        length: i64,
    }

    extern "C" {
        fn AXValueGetValue(
            value: CFTypeRef,
            value_type: u32,
            value_ptr: *mut c_void,
        ) -> bool;
    }

    // kAXValueCFRangeType = 4
    const K_AX_VALUE_CF_RANGE_TYPE: u32 = 4;

    fn get_ax_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<CFTypeRef> {
        let attr = CFString::new(attribute_name);
        let mut value: CFTypeRef = std::ptr::null();

        let err = unsafe {
            AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value)
        };

        if err != K_AX_ERROR_SUCCESS || value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    fn get_ax_string_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<String> {
        let value = get_ax_attribute(element, attribute_name)?;
        let cf_string = unsafe { CFString::wrap_under_create_rule(value as *const _) };
        Some(cf_string.to_string())
    }

    fn get_cursor_position(element: AXUIElementRef) -> Option<usize> {
        let value = get_ax_attribute(element, K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE)?;

        let mut range = CFRange {
            location: 0,
            length: 0,
        };

        let success = unsafe {
            AXValueGetValue(
                value,
                K_AX_VALUE_CF_RANGE_TYPE,
                &mut range as *mut CFRange as *mut c_void,
            )
        };

        unsafe { CFRelease(value) };

        if success && range.location >= 0 {
            Some(range.location as usize)
        } else {
            None
        }
    }

    fn extract_excerpt(full_text: &str, cursor_pos: Option<usize>, context: usize) -> String {
        let chars: Vec<char> = full_text.chars().collect();
        let len = chars.len();

        if len == 0 {
            return String::new();
        }

        let pos = match cursor_pos {
            Some(p) if p <= len => p,
            _ => {
                // fallback: 取末尾 FALLBACK_CHARS 字
                let start = len.saturating_sub(FALLBACK_CHARS);
                return chars[start..].iter().collect();
            }
        };

        let start = pos.saturating_sub(context);
        let end = (pos + context).min(len);

        chars[start..end].iter().collect()
    }

    fn is_text_input_role(role: &str) -> bool {
        matches!(
            role,
            "AXTextField" | "AXTextArea" | "AXComboBox" | "AXWebArea"
        )
    }

    use objc::runtime::Object;

    /// Convert an NSString pointer to a Rust String. Returns empty string on null.
    unsafe fn nsstring_to_string(ns_string: *mut Object) -> String {
        use objc::{msg_send, sel, sel_impl};
        if ns_string.is_null() {
            return String::new();
        }
        let utf8: *const std::os::raw::c_char = msg_send![ns_string, UTF8String];
        if utf8.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned()
        }
    }

    /// Get the frontmost NSRunningApplication.
    unsafe fn get_frontmost_running_app() -> Option<*mut Object> {
        use objc::runtime::Class;
        use objc::{msg_send, sel, sel_impl};

        let ns_workspace_class = Class::get("NSWorkspace")?;
        let workspace: *mut Object = msg_send![ns_workspace_class, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        Some(app)
    }

    pub fn get_frontmost_app_bundle_id_impl() -> Result<Option<String>, String> {
        use objc::{msg_send, sel, sel_impl};

        unsafe {
            let app = match get_frontmost_running_app() {
                Some(a) => a,
                None => return Ok(None),
            };
            let bundle_id: *mut Object = msg_send![app, bundleIdentifier];
            let s = nsstring_to_string(bundle_id);
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(s))
            }
        }
    }

    /// Extract app icon as base64-encoded PNG string.
    unsafe fn get_app_icon_base64(app: *mut Object) -> String {
        use objc::runtime::Class;
        use objc::{msg_send, sel, sel_impl};

        let icon: *mut Object = msg_send![app, icon];
        if icon.is_null() {
            return String::new();
        }

        // Get TIFF representation (contains the icon bitmap data)
        let tiff_data: *mut Object = msg_send![icon, TIFFRepresentation];
        if tiff_data.is_null() {
            return String::new();
        }

        // Create NSBitmapImageRep from TIFF (picks first/primary representation)
        let bitmap_class = match Class::get("NSBitmapImageRep") {
            Some(c) => c,
            None => return String::new(),
        };
        let bitmap: *mut Object = msg_send![bitmap_class, imageRepWithData: tiff_data];
        if bitmap.is_null() {
            return String::new();
        }

        // Convert to PNG (NSBitmapImageFileType.png = 4)
        let nil: *mut Object = std::ptr::null_mut();
        let png_data: *mut Object =
            msg_send![bitmap, representationUsingType: 4u64 properties: nil];
        if png_data.is_null() {
            return String::new();
        }

        // Base64 encode using NSData's built-in method (avoids extra crate dependency)
        let base64_ns: *mut Object =
            msg_send![png_data, base64EncodedStringWithOptions: 0u64];
        nsstring_to_string(base64_ns)
    }

    pub fn get_frontmost_app_info_impl() -> Result<Option<super::FrontmostAppInfo>, String> {
        use objc::{msg_send, sel, sel_impl};

        unsafe {
            let app = match get_frontmost_running_app() {
                Some(a) => a,
                None => return Ok(None),
            };

            let bundle_id = nsstring_to_string(msg_send![app, bundleIdentifier]);
            let name = nsstring_to_string(msg_send![app, localizedName]);

            if name.is_empty() && bundle_id.is_empty() {
                return Ok(None);
            }

            let icon_base64 = get_app_icon_base64(app);

            Ok(Some(super::FrontmostAppInfo {
                name,
                bundle_id,
                icon_base64,
            }))
        }
    }

    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        // 1. System-wide element
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return Ok(None);
        }

        // 2. Focused application
        let app = match get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            Some(a) => a,
            None => {
                unsafe { CFRelease(system_wide) };
                return Ok(None);
            }
        };

        // 3. Focused UI element
        let element = match get_ax_attribute(app, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
            Some(e) => e,
            None => {
                unsafe {
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return Ok(None);
            }
        };

        // 4. Check role
        let role = get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE);
        let target_element = match role.as_deref() {
            Some(r) if is_text_input_role(r) => {
                if r == "AXWebArea" {
                    // For Chromium-based browsers, try to get the focused child
                    match get_ax_attribute(element, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
                        Some(child) => {
                            // Use child, release original element later
                            child
                        }
                        None => element, // Fallback to WebArea itself
                    }
                } else {
                    element
                }
            }
            _ => {
                // Not a text input role
                unsafe {
                    CFRelease(element);
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return Ok(None);
            }
        };

        // 5. Get cursor position
        let cursor_pos = get_cursor_position(target_element);

        // 6. Get full text value
        let full_text = get_ax_string_attribute(target_element, K_AX_VALUE_ATTRIBUTE);

        // Cleanup
        unsafe {
            if target_element != element {
                CFRelease(target_element);
            }
            CFRelease(element);
            CFRelease(app);
            CFRelease(system_wide);
        }

        match full_text {
            Some(text) if !text.is_empty() => {
                let excerpt = extract_excerpt(&text, cursor_pos, CONTEXT_CHARS);
                if excerpt.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(excerpt))
                }
            }
            _ => Ok(None),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_extract_excerpt_empty() {
            assert_eq!(extract_excerpt("", None, 50), "");
        }

        #[test]
        fn test_extract_excerpt_short_text() {
            let text = "Hello world";
            let result = extract_excerpt(text, Some(5), 50);
            assert_eq!(result, "Hello world");
        }

        #[test]
        fn test_extract_excerpt_cursor_in_middle() {
            let text: String = (0..200).map(|i| char::from(b'a' + (i % 26) as u8)).collect();
            let result = extract_excerpt(&text, Some(100), 50);
            assert_eq!(result.chars().count(), 100); // 50 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_start() {
            let text: String = (0..200).map(|i| char::from(b'a' + (i % 26) as u8)).collect();
            let result = extract_excerpt(&text, Some(0), 50);
            assert_eq!(result.chars().count(), 50); // 0 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_end() {
            let text: String = (0..200).map(|i| char::from(b'a' + (i % 26) as u8)).collect();
            let result = extract_excerpt(&text, Some(200), 50);
            assert_eq!(result.chars().count(), 50); // 50 before + 0 after
        }

        #[test]
        fn test_extract_excerpt_no_cursor_fallback() {
            let text: String = (0..200).map(|i| char::from(b'a' + (i % 26) as u8)).collect();
            let result = extract_excerpt(&text, None, 50);
            assert_eq!(result.chars().count(), 100); // fallback last 100 chars
        }

        #[test]
        fn test_extract_excerpt_cjk_characters() {
            let text = "這是一段很長的中文測試文字，用來驗證游標附近截取功能是否正確處理多位元組字元";
            let result = extract_excerpt(text, Some(10), 5);
            assert_eq!(result.chars().count(), 10); // 5 before + 5 after
        }

        #[test]
        fn test_is_text_input_role() {
            assert!(is_text_input_role("AXTextField"));
            assert!(is_text_input_role("AXTextArea"));
            assert!(is_text_input_role("AXComboBox"));
            assert!(is_text_input_role("AXWebArea"));
            assert!(!is_text_input_role("AXButton"));
            assert!(!is_text_input_role("AXStaticText"));
        }
    }
}
