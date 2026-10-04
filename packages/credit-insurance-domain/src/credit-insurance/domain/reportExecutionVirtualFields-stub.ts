/**
 * Resolve UI language for bilingual report wording (limit warnings, etc.).
 * Accepts session language ("Hebrew" / "English") or short codes ("he" / "en").
 * Do not pass date locale (e.g. "en-US", "he-IL") — locale only controls date/time format.
 */
export function resolveAccountDisplayLanguage(
    accountLanguage: string | null | undefined
): "en" | "he" {
    if (typeof accountLanguage !== "string" || !accountLanguage.trim()) {
        return "en";
    }
    const trimmed = accountLanguage.trim().toLowerCase();
    if (trimmed === "hebrew" || trimmed === "he" || trimmed === "iw") {
        return "he";
    }
    return "en";
}
