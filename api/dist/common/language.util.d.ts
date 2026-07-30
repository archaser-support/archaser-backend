export declare const DB_LANGUAGES: readonly ["English", "Hebrew", "German", "Spanish", "French", "Italian", "Portuguese"];
export type DbLanguage = (typeof DB_LANGUAGES)[number];
export declare const DEFAULT_DB_LANGUAGE: DbLanguage;
export declare function resolveDbLanguage(value: string | null | undefined, fallback?: DbLanguage): DbLanguage;
export declare function dbLanguageToLocale(value: string | null | undefined): string;
