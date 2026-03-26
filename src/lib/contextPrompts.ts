/**
 * Context-aware prompt prefixes.
 * Prepended to the user's base prompt when context-aware enhancement is enabled.
 */
import type { AppCategory } from "./appContextMap";
import type { SupportedLocale } from "@/i18n/languageConfig";

const CONTEXT_PROMPT_PREFIXES: Record<AppCategory, Partial<Record<SupportedLocale, string>>> = {
  email: {
    en: "[Context: Email] Use formal, professional tone. Write complete sentences with proper grammar.\n\n",
    "zh-TW": "[情境：電子郵件] 使用正式、專業的語氣。寫完整的句子，注意用詞得體。\n\n",
    "zh-CN": "[情境：电子邮件] 使用正式、专业的语气。写完整的句子，注意用词得体。\n\n",
    ja: "[コンテキスト：メール] フォーマルで丁寧な文体を使用してください。敬語を適切に使用し、完全な文で書いてください。\n\n",
    ko: "[컨텍스트: 이메일] 격식 있고 전문적인 어조를 사용하세요. 완전한 문장으로 작성하세요.\n\n",
  },
  chat: {
    en: "[Context: Chat] Use casual, conversational tone. Keep it brief and natural.\n\n",
    "zh-TW": "[情境：聊天] 使用輕鬆、口語化的語氣。簡短自然即可。\n\n",
    "zh-CN": "[情境：聊天] 使用轻松、口语化的语气。简短自然即可。\n\n",
    ja: "[コンテキスト：チャット] カジュアルで会話的なトーンを使用してください。簡潔に。\n\n",
    ko: "[컨텍스트: 채팅] 캐주얼하고 대화적인 어조를 사용하세요. 간결하게.\n\n",
  },
  ide: {
    en: "[Context: Code Editor] Preserve technical terms, variable names, and code references exactly as spoken. Do not rephrase technical content.\n\n",
    "zh-TW": "[情境：程式編輯器] 保留技術術語、變數名稱和程式碼引用，不要改寫技術內容。\n\n",
    "zh-CN": "[情境：代码编辑器] 保留技术术语、变量名称和代码引用，不要改写技术内容。\n\n",
    ja: "[コンテキスト：コードエディタ] 技術用語、変数名、コード参照をそのまま保持してください。技術的な内容を言い換えないでください。\n\n",
    ko: "[컨텍스트: 코드 에디터] 기술 용어, 변수 이름, 코드 참조를 그대로 유지하세요. 기술 내용을 바꾸지 마세요.\n\n",
  },
  notes: {
    en: "[Context: Notes] Focus on clarity and readability. Use clean prose with proper paragraph breaks.\n\n",
    "zh-TW": "[情境：筆記] 注重清晰和可讀性。使用乾淨的文字，適當分段。\n\n",
    "zh-CN": "[情境：笔记] 注重清晰和可读性。使用干净的文字，适当分段。\n\n",
    ja: "[コンテキスト：ノート] 明瞭さと読みやすさを重視してください。適切に段落分けしてください。\n\n",
    ko: "[컨텍스트: 노트] 명확성과 가독성에 집중하세요. 적절하게 단락을 나누세요.\n\n",
  },
  default: {},
};

/**
 * Instruction appended to the system prompt when surrounding text is provided.
 * Tells the LLM to match the writing style and tone of the existing content.
 */
const SURROUNDING_TEXT_INSTRUCTIONS: Partial<Record<SupportedLocale, string>> = {
  en: "When <surrounding_text> is provided, match its writing style, tone, and language. Ensure your output integrates naturally with the surrounding content.",
  "zh-TW": "當提供 <surrounding_text> 時，請配合其書寫風格、語氣和語言，確保輸出能自然融入周圍內容。",
  "zh-CN": "当提供 <surrounding_text> 时，请配合其书写风格、语气和语言，确保输出能自然融入周围内容。",
  ja: "<surrounding_text> が提供された場合、その文体・トーン・言語に合わせてください。出力が周囲の内容に自然に溶け込むようにしてください。",
  ko: "<surrounding_text>가 제공되면 그 문체, 어조, 언어에 맞추세요. 출력이 주변 내용과 자연스럽게 어우러지도록 하세요.",
};

/**
 * Get the surrounding text instruction for a given locale.
 */
export function getSurroundingTextInstruction(locale: SupportedLocale): string {
  return SURROUNDING_TEXT_INSTRUCTIONS[locale] ?? SURROUNDING_TEXT_INSTRUCTIONS["en"] ?? "";
}

/**
 * Compose a context-aware prompt by prepending the category-specific
 * prefix to the user's base prompt.
 */
export function composeContextAwarePrompt(
  basePrompt: string,
  category: AppCategory,
  locale: SupportedLocale,
): string {
  if (category === "default") return basePrompt;
  const prefixMap = CONTEXT_PROMPT_PREFIXES[category];
  const prefix = prefixMap[locale] ?? prefixMap["en"] ?? "";
  if (!prefix) return basePrompt;
  return prefix + basePrompt;
}
