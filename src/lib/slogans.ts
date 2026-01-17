import i18n from "@/i18n";

/** Get all slogans from i18n */
export function getSlogans(): string[] {
  const raw = i18n.t("home.slogans", { returnObjects: true });
  if (Array.isArray(raw)) return raw as string[];
  return [];
}

/** Get a random slogan */
export function getRandomSlogan(): string {
  const slogans = getSlogans();
  if (slogans.length === 0) return "";
  return slogans[Math.floor(Math.random() * slogans.length)] ?? "";
}
