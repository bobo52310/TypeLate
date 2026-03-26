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

// ========== Surrounding Text Cache ==========
//
// The frontend invoke("read_focused_text_field") runs AFTER the HUD activates,
// which steals AX focus from the target app. To fix this, we capture the text
// in the Rust hotkey handler (before any window activation) and cache it here.

static CACHED_SURROUNDING_TEXT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Capture the focused text field content and store it in the cache.
/// Called from the hotkey handler at key-press time, before HUD activation.
pub fn capture_surrounding_text() {
    #[cfg(target_os = "macos")]
    {
        let result = macos::read_focused_text_field_impl().unwrap_or(None);
        eprintln!(
            "[text-field-reader] hotkey capture result: {}",
            match &result {
                Some(t) => format!("{} chars", t.chars().count()),
                None => "null".to_string(),
            }
        );
        if let Ok(mut cache) = CACHED_SURROUNDING_TEXT.lock() {
            *cache = result;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(mut cache) = CACHED_SURROUNDING_TEXT.lock() {
            *cache = None;
        }
    }
}

/// Retrieve and clear the cached surrounding text.
#[tauri::command]
pub fn get_cached_surrounding_text() -> Option<String> {
    CACHED_SURROUNDING_TEXT
        .lock()
        .ok()
        .and_then(|mut cache| cache.take())
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
    const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE: &str = "AXFocusedUIElement";
    const K_AX_VALUE_ATTRIBUTE: &str = "AXValue";
    const K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE: &str = "AXSelectedTextRange";
    const K_AX_ROLE_ATTRIBUTE: &str = "AXRole";

    const CONTEXT_CHARS: usize = 50;
    const FALLBACK_CHARS: usize = 100;

    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn CFArrayGetCount(array: CFTypeRef) -> i64;
        fn CFArrayGetValueAtIndex(array: CFTypeRef, idx: i64) -> CFTypeRef;
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

    /// Try to extract text+cursor from the given element.
    fn try_extract_text(element: AXUIElementRef) -> Option<(String, Option<usize>)> {
        if let Some(text) = get_ax_string_attribute(element, K_AX_VALUE_ATTRIBUTE) {
            if !text.is_empty() {
                let cursor = get_cursor_position(element);
                return Some((text, cursor));
            }
        }
        None
    }

    /// Walk AXChildren to find a child element with non-empty text.
    /// Depth-limited to avoid performance issues.
    fn find_text_in_children(element: AXUIElementRef, max_depth: u32) -> Option<(String, Option<usize>)> {
        if max_depth == 0 {
            return None;
        }

        let children = get_ax_attribute(element, "AXChildren")?;
        let count = unsafe { CFArrayGetCount(children) };

        for i in 0..count {
            let child = unsafe { CFArrayGetValueAtIndex(children, i) };
            if child.is_null() {
                continue;
            }

            // Check role — prefer text input elements
            let child_role = get_ax_string_attribute(child, K_AX_ROLE_ATTRIBUTE);
            let is_text = child_role
                .as_deref()
                .map_or(false, |r| matches!(r, "AXTextArea" | "AXTextField" | "AXComboBox"));

            if is_text {
                if let Some(result) = try_extract_text(child) {
                    unsafe { CFRelease(children) };
                    return Some(result);
                }
            }

            // Recurse into children
            if let Some(result) = find_text_in_children(child, max_depth - 1) {
                unsafe { CFRelease(children) };
                return Some(result);
            }
        }

        unsafe { CFRelease(children) };
        None
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

    /// Geometry types matching macOS CGGeometry (CGFloat = f64 on 64-bit).
    /// Only used as pointers in msg_send!, so no Encode trait needed.
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    /// Icon display size (logical points). On Retina, the CGImage may be 2x pixels.
    const ICON_SIZE: f64 = 32.0;

    /// Extract app icon as base64-encoded PNG string, constrained to ~32x32.
    unsafe fn get_app_icon_base64(app: *mut Object) -> String {
        use objc::runtime::Class;
        use objc::{msg_send, sel, sel_impl};

        let icon: *mut Object = msg_send![app, icon];
        if icon.is_null() {
            return String::new();
        }

        // Request a CGImage at 32×32 logical size (may return @2x on Retina)
        let mut proposed_rect = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: ICON_SIZE,
                height: ICON_SIZE,
            },
        };
        let nil: *mut Object = std::ptr::null_mut();
        let cg_image: *mut std::ffi::c_void = msg_send![
            icon,
            CGImageForProposedRect: &mut proposed_rect as *mut CGRect
            context: nil
            hints: nil
        ];
        if cg_image.is_null() {
            return String::new();
        }

        // Create NSBitmapImageRep from the size-constrained CGImage
        let bitmap_class = match Class::get("NSBitmapImageRep") {
            Some(c) => c,
            None => return String::new(),
        };
        let bitmap: *mut Object = msg_send![bitmap_class, alloc];
        let bitmap: *mut Object = msg_send![bitmap, initWithCGImage: cg_image];
        if bitmap.is_null() {
            return String::new();
        }

        // Convert to PNG (NSBitmapImageFileType.png = 4)
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

    /// TypeLate's own bundle ID — skip showing our own icon in the HUD.
    const SELF_BUNDLE_ID: &str = "com.typelate.app";

    pub fn get_frontmost_app_info_impl() -> Result<Option<super::FrontmostAppInfo>, String> {
        use objc::{msg_send, sel, sel_impl};

        unsafe {
            let app = match get_frontmost_running_app() {
                Some(a) => a,
                None => return Ok(None),
            };

            let bundle_id = nsstring_to_string(msg_send![app, bundleIdentifier]);
            let name = nsstring_to_string(msg_send![app, localizedName]);

            // Skip if no identifying info or if TypeLate itself is frontmost
            if (name.is_empty() && bundle_id.is_empty()) || bundle_id == SELF_BUNDLE_ID {
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

    /// Get the PID of the frontmost app (skipping TypeLate itself).
    fn get_frontmost_app_pid() -> Option<i32> {
        use objc::{msg_send, sel, sel_impl};

        unsafe {
            let app = get_frontmost_running_app()?;
            let bundle_id: *mut Object = msg_send![app, bundleIdentifier];
            let bid = nsstring_to_string(bundle_id);
            if bid == SELF_BUNDLE_ID {
                return None;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            if pid <= 0 {
                return None;
            }
            Some(pid)
        }
    }

    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        // 1. Get frontmost app PID (skips TypeLate) to target the correct process
        let pid = match get_frontmost_app_pid() {
            Some(p) => p,
            None => {
                eprintln!("[text-field-reader] no frontmost app PID found");
                return Ok(None);
            }
        };
        eprintln!("[text-field-reader] targeting app PID={}", pid);

        // 2. Create AXUIElement for the target app
        let app_element = unsafe { AXUIElementCreateApplication(pid) };
        if app_element.is_null() {
            eprintln!("[text-field-reader] failed to create AX element for PID={}", pid);
            return Ok(None);
        }

        // 3. Get focused UI element from that app
        let element = match get_ax_attribute(app_element, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
            Some(e) => e,
            None => {
                eprintln!("[text-field-reader] no focused UI element in app PID={}", pid);
                unsafe { CFRelease(app_element) };
                return Ok(None);
            }
        };

        // 4. Check role
        let role = get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE);
        eprintln!("[text-field-reader] focused element role: {:?}", role);

        // 4b. Resolve the actual text element (may differ from focused element)
        let (target_element, owns_target) = match role.as_deref() {
            Some("AXWebArea") => {
                // Chromium/Electron: try focused child within the web area
                match get_ax_attribute(element, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
                    Some(child) => {
                        let child_role = get_ax_string_attribute(child, K_AX_ROLE_ATTRIBUTE);
                        eprintln!("[text-field-reader] AXWebArea focused child role: {:?}", child_role);
                        (child, true) // we own this child (Copy rule)
                    }
                    None => {
                        eprintln!("[text-field-reader] AXWebArea has no focused child, using WebArea itself");
                        (element, false)
                    }
                }
            }
            Some(r) if is_text_input_role(r) => (element, false),
            _ => {
                // Non-text-input role (AXGroup, AXScrollArea, etc.)
                // Don't give up — try walking children to find a text field
                eprintln!("[text-field-reader] role {:?} is not a text input, searching children", role);
                (element, false)
            }
        };

        // 5. Try primary extraction on the target element
        let text_result = if is_text_input_role(
            role.as_deref().unwrap_or(""),
        ) || role.as_deref() == Some("AXWebArea")
        {
            try_extract_text(target_element)
        } else {
            None // skip primary for non-text elements, go straight to fallbacks
        };

        eprintln!(
            "[text-field-reader] primary text: {:?}",
            text_result.as_ref().map(|(t, c)| (t.len(), *c)),
        );

        // 6. Fallbacks: AXSelectedText, then walk children tree
        let text_result = text_result.or_else(|| {
            // Fallback A: AXSelectedText on the target element
            if let Some(selected) = get_ax_string_attribute(target_element, "AXSelectedText") {
                if !selected.is_empty() {
                    eprintln!("[text-field-reader] fallback: AXSelectedText ({} chars)", selected.len());
                    return Some((selected, None));
                }
            }
            // Fallback B: Walk children (up to 5 levels) for text elements
            if let Some(result) = find_text_in_children(target_element, 5) {
                eprintln!("[text-field-reader] fallback: found text in children ({} chars)", result.0.len());
                return Some(result);
            }
            eprintln!("[text-field-reader] no text found (all strategies exhausted)");
            None
        });

        // Cleanup
        unsafe {
            if owns_target {
                CFRelease(target_element);
            }
            CFRelease(element);
            CFRelease(app_element);
        }

        match text_result {
            Some((text, cursor_pos)) => {
                let excerpt = extract_excerpt(&text, cursor_pos, CONTEXT_CHARS);
                if excerpt.is_empty() {
                    Ok(None)
                } else {
                    eprintln!("[text-field-reader] returning excerpt ({} chars)", excerpt.chars().count());
                    Ok(Some(excerpt))
                }
            }
            None => Ok(None),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        // ── extract_excerpt ──

        #[test]
        fn test_extract_excerpt_empty() {
            assert_eq!(extract_excerpt("", None, 50), "");
        }

        #[test]
        fn test_extract_excerpt_empty_with_cursor() {
            assert_eq!(extract_excerpt("", Some(0), 50), "");
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
            assert_eq!(result.chars().count(), 100); // fallback last FALLBACK_CHARS chars
        }

        #[test]
        fn test_extract_excerpt_no_cursor_short_text() {
            // Text shorter than FALLBACK_CHARS → return entire text
            let text = "Short text";
            let result = extract_excerpt(text, None, 50);
            assert_eq!(result, "Short text");
        }

        #[test]
        fn test_extract_excerpt_cjk_characters() {
            let text = "這是一段很長的中文測試文字，用來驗證游標附近截取功能是否正確處理多位元組字元";
            let result = extract_excerpt(text, Some(10), 5);
            assert_eq!(result.chars().count(), 10); // 5 before + 5 after
        }

        #[test]
        fn test_extract_excerpt_emoji() {
            let text = "Hello 🌍 World 🚀 Test 🎉 End";
            let result = extract_excerpt(text, Some(8), 3);
            // Emoji is 1 char; chars around pos 8: 3 before + 3 after
            assert_eq!(result.chars().count(), 6);
        }

        #[test]
        fn test_extract_excerpt_cursor_out_of_bounds() {
            let text = "Hello world";
            // cursor > len → fallback to last FALLBACK_CHARS
            let result = extract_excerpt(text, Some(999), 50);
            assert_eq!(result, "Hello world"); // text is shorter than FALLBACK_CHARS
        }

        #[test]
        fn test_extract_excerpt_context_zero() {
            let text = "Hello world";
            let result = extract_excerpt(text, Some(5), 0);
            // 0 context on each side → empty
            assert_eq!(result, "");
        }

        #[test]
        fn test_extract_excerpt_context_one() {
            let text = "abcde";
            let result = extract_excerpt(text, Some(2), 1);
            // 1 before + 1 after cursor pos 2 → "bc"
            assert_eq!(result, "bc");
        }

        #[test]
        fn test_extract_excerpt_mixed_cjk_ascii() {
            let text = "Hello你好World世界End";
            // Length: H-e-l-l-o-你-好-W-o-r-l-d-世-界-E-n-d = 17 chars
            let result = extract_excerpt(text, Some(7), 3);
            // pos 7 = 'W', 3 before (好W → 你好W... wait let me count)
            // chars: 0=H 1=e 2=l 3=l 4=o 5=你 6=好 7=W 8=o 9=r 10=l 11=d 12=世 13=界 14=E 15=n 16=d
            // start = 7-3=4, end = 7+3=10 → chars[4..10] = "o你好Wor"
            assert_eq!(result, "o你好Wor");
        }

        #[test]
        fn test_extract_excerpt_single_char_text() {
            assert_eq!(extract_excerpt("X", Some(0), 50), "X");
            assert_eq!(extract_excerpt("X", Some(1), 50), "X");
            assert_eq!(extract_excerpt("X", None, 50), "X");
        }

        // ── is_text_input_role ──

        #[test]
        fn test_is_text_input_role() {
            assert!(is_text_input_role("AXTextField"));
            assert!(is_text_input_role("AXTextArea"));
            assert!(is_text_input_role("AXComboBox"));
            assert!(is_text_input_role("AXWebArea"));
            assert!(!is_text_input_role("AXButton"));
            assert!(!is_text_input_role("AXStaticText"));
            assert!(!is_text_input_role("AXGroup"));
            assert!(!is_text_input_role("AXScrollArea"));
            assert!(!is_text_input_role("AXSplitGroup"));
            assert!(!is_text_input_role(""));
        }

        // ── Cache mechanism ──
        // Note: tests run in parallel threads sharing the same static.
        // We use a test-specific key pattern to avoid interference.

        #[test]
        fn test_cache_stores_and_retrieves() {
            // Write to cache
            {
                let mut cache = super::super::CACHED_SURROUNDING_TEXT.lock().unwrap();
                *cache = Some("test surrounding text".to_string());
            }
            // Read via the public function
            let result = super::super::get_cached_surrounding_text();
            assert_eq!(result, Some("test surrounding text".to_string()));
        }

        #[test]
        fn test_cache_clears_on_read() {
            {
                let mut cache = super::super::CACHED_SURROUNDING_TEXT.lock().unwrap();
                *cache = Some("will be cleared".to_string());
            }
            let _ = super::super::get_cached_surrounding_text(); // consume
            let second = super::super::get_cached_surrounding_text();
            assert_eq!(second, None);
        }

        #[test]
        fn test_cache_returns_none_when_empty() {
            {
                let mut cache = super::super::CACHED_SURROUNDING_TEXT.lock().unwrap();
                *cache = None;
            }
            let result = super::super::get_cached_surrounding_text();
            assert_eq!(result, None);
        }
    }
}
