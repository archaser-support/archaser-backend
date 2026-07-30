"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DB_LANGUAGE = exports.DB_LANGUAGES = void 0;
exports.resolveDbLanguage = resolveDbLanguage;
exports.dbLanguageToLocale = dbLanguageToLocale;
exports.DB_LANGUAGES = [
    "English",
    "Hebrew",
    "German",
    "Spanish",
    "French",
    "Italian",
    "Portuguese",
];
exports.DEFAULT_DB_LANGUAGE = "English";
const LOCALE_TO_DB_LANGUAGE = {
    en: "English",
    he: "Hebrew",
    iw: "Hebrew",
    de: "German",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    pt: "Portuguese",
};
const DB_LANGUAGE_BY_LOWER_NAME = new Map(exports.DB_LANGUAGES.map((name) => [name.toLowerCase(), name]));
function resolveDbLanguage(value, fallback = exports.DEFAULT_DB_LANGUAGE) {
    if (!value) {
        return fallback;
    }
    const trimmed = value.trim();
    const byName = DB_LANGUAGE_BY_LOWER_NAME.get(trimmed.toLowerCase());
    if (byName) {
        return byName;
    }
    const base = trimmed.toLowerCase().split(/[-_]/)[0];
    return LOCALE_TO_DB_LANGUAGE[base] ?? fallback;
}
function dbLanguageToLocale(value) {
    const language = resolveDbLanguage(value);
    const entry = Object.entries(LOCALE_TO_DB_LANGUAGE).find(([code, name]) => name === language && code.length === 2 && code !== "iw");
    return entry?.[0] ?? "en";
}
//# sourceMappingURL=language.util.js.map