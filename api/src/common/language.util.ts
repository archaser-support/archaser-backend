/**
 * The database stores languages as the Prisma `language` enum names ("Hebrew"),
 * while the web tier speaks BCP-47-ish locale codes ("he"). Anything joining a
 * request locale to a `*Language` translation table has to cross that gap.
 */
export const DB_LANGUAGES = [
    "English",
    "Hebrew",
    "German",
    "Spanish",
    "French",
    "Italian",
    "Portuguese",
] as const;

export type DbLanguage = (typeof DB_LANGUAGES)[number];

export const DEFAULT_DB_LANGUAGE: DbLanguage = "English";

const LOCALE_TO_DB_LANGUAGE: Record<string, DbLanguage> = {
    en: "English",
    he: "Hebrew",
    iw: "Hebrew", // Legacy ISO code for Hebrew; still emitted by some clients.
    de: "German",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    pt: "Portuguese",
};

const DB_LANGUAGE_BY_LOWER_NAME = new Map<string, DbLanguage>(
    DB_LANGUAGES.map((name) => [name.toLowerCase(), name])
);

/**
 * Accepts a locale code ("he", "he-IL") or an enum name ("Hebrew") and returns
 * the enum name, so callers can pass a request query param or a stored column
 * value interchangeably. Unknown input resolves to English rather than throwing:
 * a translation lookup falling back to the base language is not an error.
 */
export function resolveDbLanguage(
    value: string | null | undefined,
    fallback: DbLanguage = DEFAULT_DB_LANGUAGE
): DbLanguage {
    if (!value) {
        return fallback;
    }

    const trimmed = value.trim();
    const byName = DB_LANGUAGE_BY_LOWER_NAME.get(trimmed.toLowerCase());
    if (byName) {
        return byName;
    }

    // "he-IL" and "pt_BR" both carry the language in the first subtag.
    const base = trimmed.toLowerCase().split(/[-_]/)[0];
    return LOCALE_TO_DB_LANGUAGE[base] ?? fallback;
}

/** Inverse of {@link resolveDbLanguage}, for values sent back to the client. */
export function dbLanguageToLocale(value: string | null | undefined): string {
    const language = resolveDbLanguage(value);
    const entry = Object.entries(LOCALE_TO_DB_LANGUAGE).find(
        ([code, name]) => name === language && code.length === 2 && code !== "iw"
    );
    return entry?.[0] ?? "en";
}
