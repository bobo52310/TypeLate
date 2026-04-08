export interface ChangelogSection {
  heading: string;
  emoji?: string;
  items: string[];
}

const PLACEHOLDER_BODY = "See the assets to download and install this version.";
const HEADING_RE = /^###\s+(.*)/;
const BULLET_RE = /^[-*]\s+(.*)/;
const EMOJI_RE = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u;

/**
 * Parse release notes markdown (CI-generated format) into structured sections.
 *
 * Expected format:
 *   ### ✨ New Features
 *   - item one
 *   - item two
 *   ### 🐛 Bug Fixes
 *   - fix one
 */
export function parseReleaseNotes(body: string | undefined): ChangelogSection[] {
  if (!body || body.trim() === "" || body.trim() === PLACEHOLDER_BODY) {
    return [{ heading: "Improvements", items: ["Bug fixes and performance improvements"] }];
  }

  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();

    // Stop at footer separators
    if (line === "---" || line.startsWith("**Full Changelog**")) break;

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      if (current && current.items.length > 0) sections.push(current);
      let text = headingMatch[1]!.trim();
      let emoji: string | undefined;
      const emojiMatch = text.match(EMOJI_RE);
      if (emojiMatch) {
        emoji = emojiMatch[1];
        text = text.slice(emojiMatch[0]!.length).trim();
      }
      current = { heading: text, emoji, items: [] };
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch && current) {
      current.items.push(bulletMatch[1]!.trim());
    }
  }

  if (current && current.items.length > 0) sections.push(current);

  if (sections.length === 0) {
    return [{ heading: "Improvements", items: ["Bug fixes and performance improvements"] }];
  }

  return sections;
}
