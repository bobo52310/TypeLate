/**
 * App context categorization for context-aware enhancement.
 * Maps macOS bundle identifiers to categories that determine
 * the tone of AI text enhancement.
 */

export type AppCategory = "email" | "chat" | "ide" | "notes" | "default";

const DEFAULT_APP_CATEGORY_MAP: Record<string, AppCategory> = {
  // Email
  "com.apple.mail": "email",
  "com.microsoft.Outlook": "email",

  // Chat
  "com.tinyspeck.slackmacgap": "chat",
  "com.hnc.Discord": "chat",
  "com.apple.MobileSMS": "chat",
  "ru.keepcoder.Telegram": "chat",
  "com.facebook.archon": "chat",
  "jp.naver.line.mac": "chat",

  // IDE
  "com.microsoft.VSCode": "ide",
  "com.apple.dt.Xcode": "ide",
  "com.jetbrains.intellij": "ide",
  "com.googlecode.iterm2": "ide",
  "com.apple.Terminal": "ide",
  "dev.warp.Warp-Stable": "ide",

  // Notes
  "com.apple.Notes": "notes",
  "md.obsidian": "notes",
  "notion.id": "notes",
  "net.shinyfrog.bear": "notes",
};

/**
 * Resolve an app bundle ID to a category.
 * User overrides take precedence over built-in defaults.
 */
export function resolveAppCategory(
  bundleId: string | null,
  userOverrides: Record<string, AppCategory>,
): AppCategory {
  if (!bundleId) return "default";
  return userOverrides[bundleId] ?? DEFAULT_APP_CATEGORY_MAP[bundleId] ?? "default";
}
