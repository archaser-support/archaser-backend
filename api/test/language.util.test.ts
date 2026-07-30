import {
    dbLanguageToLocale,
    resolveDbLanguage,
} from "../src/common/language.util";

describe("resolveDbLanguage", () => {
    it("maps the locale codes the web tier sends to enum names", () => {
        expect(resolveDbLanguage("he")).toBe("Hebrew");
        expect(resolveDbLanguage("en")).toBe("English");
        expect(resolveDbLanguage("pt")).toBe("Portuguese");
    });

    it("passes enum names through, so stored columns can be compared directly", () => {
        expect(resolveDbLanguage("Hebrew")).toBe("Hebrew");
        expect(resolveDbLanguage("hebrew")).toBe("Hebrew");
    });

    it("reads the language out of a regional tag", () => {
        expect(resolveDbLanguage("he-IL")).toBe("Hebrew");
        expect(resolveDbLanguage("pt_BR")).toBe("Portuguese");
    });

    it("accepts the legacy ISO code for Hebrew", () => {
        expect(resolveDbLanguage("iw")).toBe("Hebrew");
    });

    it("falls back rather than throwing, since a missing translation is not an error", () => {
        expect(resolveDbLanguage(null)).toBe("English");
        expect(resolveDbLanguage("")).toBe("English");
        expect(resolveDbLanguage("klingon")).toBe("English");
        expect(resolveDbLanguage(undefined, "Hebrew")).toBe("Hebrew");
        expect(resolveDbLanguage("klingon", "Hebrew")).toBe("Hebrew");
    });

    it("round-trips back to a locale code for responses", () => {
        expect(dbLanguageToLocale("Hebrew")).toBe("he");
        expect(dbLanguageToLocale("he")).toBe("he");
        expect(dbLanguageToLocale("English")).toBe("en");
        expect(dbLanguageToLocale("nonsense")).toBe("en");
    });
});
