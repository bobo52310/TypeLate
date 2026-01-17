import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import { detectSystemLocale } from "./languageConfig";

const resources = {
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },
  "zh-CN": { translation: zhCN },
  "zh-TW": { translation: zhTW },
};

i18n.use(initReactI18next).init({
  resources,
  lng: detectSystemLocale(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
