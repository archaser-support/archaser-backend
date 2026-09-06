export function resolveAccountDisplayLanguage(
    _accountLanguage: string | null | undefined
): string {
    return typeof _accountLanguage === "string" && _accountLanguage.trim()
        ? _accountLanguage.trim()
        : "en";
}
