import {
    EMAIL_TYPES,
    getEmailSubject,
    getEmailTemplate,
    templateExists,
} from "../src/email/email-templates";
import { addEnvironmentPrefixToEmailSubject } from "../src/email/email-subject-prefix";
import { SystemEmailService } from "../src/email/system-email.service";

describe("email-templates loader", () => {
    it("loads branded welcome-user en template with substitutions", () => {
        expect(templateExists(EMAIL_TYPES.WELCOME_USER, "en")).toBe(true);
        const html = getEmailTemplate(EMAIL_TYPES.WELCOME_USER, "en", {
            user_name: "Ada Lovelace",
            reset_link: "https://example.com/reset-password/abc",
            product_title: "ARchaser",
            product_subtitle: "Your platform",
            welcome_intro: "Welcome intro",
            feature_1: "f1",
            feature_2: "f2",
            feature_3: "f3",
            feature_4: "f4",
            feature_5: "f5",
        });
        expect(html).toContain("email-container");
        expect(html).toContain("Ada Lovelace");
        expect(html).toContain("https://example.com/reset-password/abc");
        expect(html).toContain("Welcome to ARchaser");
    });

    it("loads forgot-password he template", () => {
        const html = getEmailTemplate(EMAIL_TYPES.FORGOT_PASSWORD, "he", {
            first_name: "ישראל",
            username: "user1",
            reset_link: "https://example.com/reset-password/tok",
        });
        expect(html).toContain("email-container");
        expect(html).toContain("ישראל");
        expect(html).toContain("https://example.com/reset-password/tok");
    });

    it("falls back to en for unknown language", () => {
        const html = getEmailTemplate(EMAIL_TYPES.REPORT_SHARED, "fr", {
            userName: "Sam",
            creatorName: "Pat",
            reportName: "Aging",
            reportUrl: "https://example.com/r/1",
            permission: "view",
        });
        expect(html).toContain("Aging");
        expect(getEmailSubject(EMAIL_TYPES.REPORT_SHARED, "en", {
            reportName: "Aging",
        })).toContain("Aging");
    });
});

describe("SystemEmailService welcome content", () => {
    it("builds credit-only welcome vars", () => {
        const svc = Object.create(
            SystemEmailService.prototype
        ) as SystemEmailService;
        const vars = svc.buildWelcomeContentVars({
            hasCollection: false,
            hasCreditInsurance: true,
            language: "en",
        });
        expect(vars.product_subtitle).toMatch(/credit insurance/i);
        expect(vars.welcome_intro).toMatch(/Welcome to ARchaser/);
    });
});

describe("email subject prefix", () => {
    const prev = process.env.NODE_ENV;
    afterEach(() => {
        (process.env as { NODE_ENV?: string }).NODE_ENV = prev;
    });

    it("prefixes local subjects in development", () => {
        (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
        expect(addEnvironmentPrefixToEmailSubject("Hello")).toBe(
            "[LOCAL] Hello"
        );
    });
});
