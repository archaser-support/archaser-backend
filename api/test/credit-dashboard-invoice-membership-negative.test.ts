import {
    reportingCountdownMembershipWhere,
    termsBreachMembershipWhere,
} from "@archaser/credit-insurance-domain";

describe("credit dashboard invoice membership — exclude negative amounts", () => {
    it("reporting countdown membership excludes amount < 0", () => {
        const where = reportingCountdownMembershipWhere(42, 14);
        expect(where).toMatchObject({
            account_id: 42,
            amount: { gte: 0 },
        });
    });

    it("terms-breach membership excludes amount < 0 (including reporting_breach filter)", () => {
        const where = termsBreachMembershipWhere(7, {
            termsBreachReason: "reporting_breach",
        });
        expect(where).toMatchObject({
            account_id: 7,
            reporting_breach: true,
            amount: { gte: 0 },
        });
    });

    it("terms-breach OR membership still excludes negatives without clobbering breach OR", () => {
        const where = termsBreachMembershipWhere(3);
        expect(where.amount).toEqual({ gte: 0 });
        expect(where.OR).toEqual(
            expect.arrayContaining([{ reporting_breach: true }])
        );
    });

    it("still scopes positive-path fields for countdown (status, target date window)", () => {
        const where = reportingCountdownMembershipWhere(1, 7);
        expect(where.status).toEqual({ in: ["Due", "Overdue"] });
        expect(where.target_reporting_date).toBeDefined();
        expect(where.actual_reporting_date).toBeNull();
        expect(where.reporting_breach).toBe(false);
        expect(where.amount).toEqual({ gte: 0 });
    });
});
