import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";
import ko from "@/i18n/locales/ko.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import zhTW from "@/i18n/locales/zh-TW.json";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function collectKeyPaths(obj: Record<string, JsonValue>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...collectKeyPaths(value as Record<string, JsonValue>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

const enKeys = collectKeyPaths(en as Record<string, JsonValue>);

const LOCALES: [string, Record<string, JsonValue>][] = [
  ["ja", ja as Record<string, JsonValue>],
  ["ko", ko as Record<string, JsonValue>],
  ["zh-CN", zhCN as Record<string, JsonValue>],
  ["zh-TW", zhTW as Record<string, JsonValue>],
];

describe("i18n key completeness", () => {
  it("en.json has keys (sanity check)", () => {
    expect(enKeys.length).toBeGreaterThan(100);
  });

  for (const [locale, data] of LOCALES) {
    describe(locale, () => {
      const localeKeys = collectKeyPaths(data);

      it("has no missing keys compared to en.json", () => {
        const missing = enKeys.filter((k) => !localeKeys.includes(k));
        if (missing.length > 0) {
          throw new Error(
            `${locale} is missing ${missing.length} key(s):\n  ${missing.join("\n  ")}`,
          );
        }
      });

      it("has no extra keys not in en.json", () => {
        const extra = localeKeys.filter((k) => !enKeys.includes(k));
        // Allow a small number of locale-specific keys (e.g. nav.dictionary)
        if (extra.length > 5) {
          throw new Error(
            `${locale} has ${extra.length} unexpected key(s):\n  ${extra.join("\n  ")}`,
          );
        }
      });
    });
  }
});
