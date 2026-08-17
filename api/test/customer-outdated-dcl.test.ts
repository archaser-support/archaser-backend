import { Prisma } from "@prisma/client";
import {
    computeCustomerOutdatedDcl,
    isDclCustomerCreditScoreBelowPolicyMin,
    resolveDclApprovedLimitAfterOutdatedRecompute,
} from "../src/credit-insurance/domain/customerOutdatedDcl";

describe("computeCustomerOutdatedDcl", () => {
    it("returns false when limit type is not DCL", () => {
        expect(
            computeCustomerOutdatedDcl({
                limitType: "Named",
                creditScore: 10,
                minCreditScore: 100,
                creditScoreInputDate: new Date("2025-01-01"),
                scoreValidityPeriodMonths: 12,
                activeCustomerSince: new Date("2020-01-01"),
                dclCustomerSinceMonths: 24,
                today: new Date("2026-01-01"),
            })
        ).toBe(false);
    });

    it("returns true when credit score is below policy min score", () => {
        expect(
            computeCustomerOutdatedDcl({
                limitType: "DCL",
                creditScore: 620,
                minCreditScore: 650,
                creditScoreInputDate: null,
                scoreValidityPeriodMonths: null,
                activeCustomerSince: null,
                dclCustomerSinceMonths: null,
            })
        ).toBe(true);
    });

    it("returns true when score validity window is expired", () => {
        expect(
            computeCustomerOutdatedDcl({
                limitType: "DCL",
                creditScore: null,
                minCreditScore: null,
                creditScoreInputDate: new Date("2025-01-01"),
                scoreValidityPeriodMonths: 12,
                activeCustomerSince: null,
                dclCustomerSinceMonths: null,
                today: new Date("2026-01-02"),
            })
        ).toBe(true);
    });

    it("marks DCL outdated when active-since is on the threshold date", () => {
        expect(
            computeCustomerOutdatedDcl({
                limitType: "DCL",
                creditScore: null,
                minCreditScore: null,
                creditScoreInputDate: null,
                scoreValidityPeriodMonths: null,
                activeCustomerSince: new Date("2025-05-17"),
                dclCustomerSinceMonths: 12,
                today: new Date("2026-05-17"),
            })
        ).toBe(true);
    });

    it("marks DCL outdated when active-since is newer than the threshold date", () => {
        expect(
            computeCustomerOutdatedDcl({
                limitType: "DCL",
                creditScore: null,
                minCreditScore: null,
                creditScoreInputDate: null,
                scoreValidityPeriodMonths: null,
                activeCustomerSince: new Date("2025-08-01"),
                dclCustomerSinceMonths: 12,
                today: new Date("2026-05-17"),
            })
        ).toBe(true);
    });

    it("does not mark DCL outdated from tenure when active-since is older than the threshold", () => {
        expect(
            computeCustomerOutdatedDcl({
                limitType: "DCL",
                creditScore: 700,
                minCreditScore: 650,
                creditScoreInputDate: new Date("2026-01-01"),
                scoreValidityPeriodMonths: 12,
                activeCustomerSince: new Date("2024-01-01"),
                dclCustomerSinceMonths: 12,
                today: new Date("2026-05-17"),
            })
        ).toBe(false);
    });
});

describe("isDclCustomerCreditScoreBelowPolicyMin", () => {
    it("returns false when limit type is not DCL", () => {
        expect(
            isDclCustomerCreditScoreBelowPolicyMin({
                limitType: "Named",
                creditScore: 1,
                minCreditScore: 900,
            })
        ).toBe(false);
    });

    it("returns true when DCL and score is below policy min", () => {
        expect(
            isDclCustomerCreditScoreBelowPolicyMin({
                limitType: "DCL",
                creditScore: 620,
                minCreditScore: 650,
            })
        ).toBe(true);
    });

    it("returns false when DCL and score equals policy min", () => {
        expect(
            isDclCustomerCreditScoreBelowPolicyMin({
                limitType: "DCL",
                creditScore: 650,
                minCreditScore: 650,
            })
        ).toBe(false);
    });
});

describe("resolveDclApprovedLimitAfterOutdatedRecompute", () => {
    const today = new Date("2026-03-01T12:00:00.000Z");

    it("does not auto-adjust when credit score is below policy min", () => {
        const r = resolveDclApprovedLimitAfterOutdatedRecompute({
            limitType: "DCL",
            outdatedDcl: false,
            creditScore: 600,
            minCreditScore: 650,
            userProvidedApprovedLimit: false,
            existingApprovedLimit: new Prisma.Decimal(50000),
            patchedApprovedLimit: undefined,
            approvedLimitExpirationDate: null,
            policyMaxDcl: new Prisma.Decimal(100000),
            today,
        });
        expect(r.approved_limit).toBeUndefined();
    });

    it("restores policy max_dcl when DCL is current, score OK, limit is zero, and expiration not past", () => {
        const r = resolveDclApprovedLimitAfterOutdatedRecompute({
            limitType: "DCL",
            outdatedDcl: false,
            creditScore: 700,
            minCreditScore: 650,
            userProvidedApprovedLimit: false,
            existingApprovedLimit: new Prisma.Decimal(0),
            patchedApprovedLimit: undefined,
            approvedLimitExpirationDate: new Date("2026-12-31"),
            policyMaxDcl: new Prisma.Decimal(99999),
            today,
        });
        expect(r.approved_limit?.equals(99999)).toBe(true);
    });
});
