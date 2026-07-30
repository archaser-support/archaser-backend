import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    aggregateDailyHealthToMonthly,
    applyWithoutPolicyToNoCoverageDay,
    assignUtilizationDistributionBin,
    buildCostsSection,
    buildDailyHealthPoint,
    buildDualDailyHealthSeries,
    buildNoCoverageSection,
    buildPortfolioHealthSection,
    buildUtilizationDistribution,
    buildUtilizationSection,
    classifyNoCoverageReason,
    computeAverageCompliantExposure,
    computeDailyPortfolioUtilizationPct,
    computeDailyTopUpUtilizationPct,
    computeDclVsNamedFootprints,
    computeEffectiveCost,
    computePolicyEfficiency,
    computePortfolioHealthSeriesMetrics,
    computeSelfVsApprovedShares,
    computeUtilizationPeriodMetrics,
    getCreditPortfolioHealth,
    isApprovedCoverageCustomer,
    isInsurerDeclinedReason,
    longestExactValueStreak,
    longestExactValueStreakWindow,
    parsePortfolioHealthDateRange,
    pickMainViolationReason,
    shouldIncludeCptRowInHealthScope,
    defaultPortfolioHealthDateRange,
    countInclusiveCalendarDays,
} from "../src/credit-insurance/domain/creditPortfolioHealthService";
import { computePortfolioRangeCost } from "../src/credit-insurance/domain/portfolioRangeCost";

jest.mock("../src/credit-insurance/domain-db", () => ({
    prisma: {
        account: {
            findUnique: jest.fn(),
        },
        customer: {
            findMany: jest.fn(),
        },
        customerTopUp: {
            findMany: jest.fn(),
        },
        invoice: {
            findMany: jest.fn(),
        },
        $queryRaw: jest.fn(),
    },
    bindCreditInsurancePrisma: jest.fn(),
}));

import { prisma } from "../src/credit-insurance/domain-db";

describe("creditPortfolioHealthService date helpers", () => {
    it("defaults to 30 inclusive UTC days ending today", () => {
        const today = new Date(Date.UTC(2026, 6, 12));
        const range = defaultPortfolioHealthDateRange(today);
        expect(range.to).toBe("2026-07-12");
        expect(range.from).toBe("2026-06-13");
        expect(countInclusiveCalendarDays(range.from, range.to)).toBe(30);
    });

    it("parses from/to and computes daysInRange", () => {
        const parsed = parsePortfolioHealthDateRange("2026-07-01", "2026-07-10");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.daysInRange).toBe(10);
        expect(parsed.from).toBe("2026-07-01");
        expect(parsed.to).toBe("2026-07-10");
    });

    it("rejects inverted ranges", () => {
        const parsed = parsePortfolioHealthDateRange("2026-07-10", "2026-07-01");
        expect(parsed).toEqual({ error: "from must be on or before to" });
    });
});

describe("dual Health A/B pure helpers", () => {
    it("detects insurer declined case-insensitively", () => {
        expect(isInsurerDeclinedReason("Insurer declined")).toBe(true);
        expect(isInsurerDeclinedReason(" insurer DECLINED ")).toBe(true);
        expect(isInsurerDeclinedReason("Pending review")).toBe(false);
        expect(isInsurerDeclinedReason(null)).toBe(false);
    });

    it("excludes pending-review open-AR rows when no-policy cohort is off", () => {
        expect(
            shouldIncludeCptRowInHealthScope({
                includeNoPolicyExposure: false,
                exclusionReason: "Pending review",
                totalReceivables: 100,
            })
        ).toBe(false);
        expect(
            shouldIncludeCptRowInHealthScope({
                includeNoPolicyExposure: true,
                exclusionReason: "Pending review",
                totalReceivables: 100,
            })
        ).toBe(true);
        expect(
            shouldIncludeCptRowInHealthScope({
                includeNoPolicyExposure: false,
                exclusionReason: "Insurer declined",
                totalReceivables: 100,
            })
        ).toBe(true);
    });

    it("computes longest calendar streak at the exact trough", () => {
        const streak = longestExactValueStreak(
            [
                { snapshotDate: "2026-07-01", value: 90 },
                { snapshotDate: "2026-07-02", value: 70 },
                { snapshotDate: "2026-07-03", value: 70 },
                { snapshotDate: "2026-07-04", value: 80 },
                { snapshotDate: "2026-07-05", value: 70 },
            ],
            70
        );
        expect(streak).toBe(2);
    });

    it("returns trough window start/end for a single longest streak", () => {
        const window = longestExactValueStreakWindow(
            [
                { snapshotDate: "2026-07-01", value: 90 },
                { snapshotDate: "2026-07-02", value: 70 },
                { snapshotDate: "2026-07-03", value: 70 },
                { snapshotDate: "2026-07-04", value: 80 },
                { snapshotDate: "2026-07-05", value: 70 },
            ],
            70
        );
        expect(window).toEqual({
            days: 2,
            start: "2026-07-02",
            end: "2026-07-03",
        });
    });

    it("picks the most recent equal-length trough window on tie", () => {
        const window = longestExactValueStreakWindow(
            [
                { snapshotDate: "2026-07-01", value: 70 },
                { snapshotDate: "2026-07-02", value: 70 },
                { snapshotDate: "2026-07-03", value: 90 },
                { snapshotDate: "2026-07-04", value: 70 },
                { snapshotDate: "2026-07-05", value: 70 },
            ],
            70
        );
        expect(window).toEqual({
            days: 2,
            start: "2026-07-04",
            end: "2026-07-05",
        });
    });

    it("returns peak window with most-recent tie-break (peak-ready helper)", () => {
        const window = longestExactValueStreakWindow(
            [
                { snapshotDate: "2026-07-01", value: 110 },
                { snapshotDate: "2026-07-02", value: 110 },
                { snapshotDate: "2026-07-03", value: 90 },
                { snapshotDate: "2026-07-04", value: 110 },
                { snapshotDate: "2026-07-05", value: 110 },
            ],
            110
        );
        expect(window).toEqual({
            days: 2,
            start: "2026-07-04",
            end: "2026-07-05",
        });
    });

    it("breaks trough streak across missing calendar days", () => {
        const streak = longestExactValueStreak(
            [
                { snapshotDate: "2026-07-01", value: 60 },
                { snapshotDate: "2026-07-02", value: 60 },
                // 2026-07-03 missing
                { snapshotDate: "2026-07-04", value: 60 },
            ],
            60
        );
        expect(streak).toBe(2);
        expect(
            longestExactValueStreakWindow(
                [
                    { snapshotDate: "2026-07-01", value: 60 },
                    { snapshotDate: "2026-07-02", value: 60 },
                    { snapshotDate: "2026-07-04", value: 60 },
                ],
                60
            )
        ).toEqual({
            days: 2,
            start: "2026-07-01",
            end: "2026-07-02",
        });
    });

    it("averages daily health and uses available days for % below 85", () => {
        const daily = [
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 100,
                compliantExposure: 90,
                atRiskExposure: 10,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-02",
                totalReceivables: 100,
                compliantExposure: 88,
                atRiskExposure: 12,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-03",
                totalReceivables: 100,
                compliantExposure: 70,
                atRiskExposure: 30,
            }),
        ];
        const metrics = computePortfolioHealthSeriesMetrics(daily);
        expect(metrics.averageHealthPct).toBeCloseTo((90 + 88 + 70) / 3, 5);
        expect(metrics.lowestHealthPct).toBe(70);
        expect(metrics.lowestHealthStreakDays).toBe(1);
        expect(metrics.lowestHealthStreakStart).toBe("2026-07-03");
        expect(metrics.lowestHealthStreakEnd).toBe("2026-07-03");
        // only 2026-07-03 is below 85 → 1/3
        expect(metrics.pctDaysBelow85).toBeCloseTo(100 / 3, 5);
    });

    it("excludes zero-AR days from health series KPIs", () => {
        const daily = [
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 100,
                compliantExposure: 80,
                atRiskExposure: 20,
            }),
            // AR = 0 → health 100 by definition; must not affect KPIs
            buildDailyHealthPoint({
                snapshotDate: "2026-07-02",
                totalReceivables: 0,
                compliantExposure: 0,
                atRiskExposure: 0,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-03",
                totalReceivables: 100,
                compliantExposure: 90,
                atRiskExposure: 10,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-04",
                totalReceivables: 0,
                compliantExposure: 0,
                atRiskExposure: 0,
            }),
        ];
        const metrics = computePortfolioHealthSeriesMetrics(daily);
        expect(metrics.averageHealthPct).toBeCloseTo((80 + 90) / 2, 5);
        expect(metrics.lowestHealthPct).toBe(80);
        expect(metrics.lowestHealthStreakDays).toBe(1);
        expect(metrics.lowestHealthStreakStart).toBe("2026-07-01");
        expect(metrics.lowestHealthStreakEnd).toBe("2026-07-01");
        // only 2026-07-01 is below 85 among eligible days → 1/2
        expect(metrics.pctDaysBelow85).toBeCloseTo(50, 5);
    });

    it("returns zero health KPIs when every day has AR = 0", () => {
        const metrics = computePortfolioHealthSeriesMetrics([
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 0,
                compliantExposure: 0,
                atRiskExposure: 0,
            }),
        ]);
        expect(metrics).toEqual({
            averageHealthPct: 0,
            lowestHealthPct: 0,
            lowestHealthStreakDays: 0,
            lowestHealthStreakStart: null,
            lowestHealthStreakEnd: null,
            pctDaysBelow85: 0,
        });
    });

    it("falls back to approved_limit in portfolio util SQL fragments", () => {
        const source = readFileSync(
            resolve(
                __dirname,
                "../src/credit-insurance/domain/creditPortfolioHealthService.ts"
            ),
            "utf8"
        );
        expect(source).toContain(
            "COALESCE(t.effective_approved_limit, t.approved_limit, 0)"
        );
        expect(source).not.toMatch(
            /SUM\(\s*COALESCE\(t\.effective_approved_limit,\s*0\)::float8\s*\)/
        );
    });

    it("exposes trough streak window on series metrics when two equal troughs exist", () => {
        const daily = [
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 100,
                compliantExposure: 50,
                atRiskExposure: 50,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-02",
                totalReceivables: 100,
                compliantExposure: 50,
                atRiskExposure: 50,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-03",
                totalReceivables: 100,
                compliantExposure: 90,
                atRiskExposure: 10,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-04",
                totalReceivables: 100,
                compliantExposure: 50,
                atRiskExposure: 50,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-05",
                totalReceivables: 100,
                compliantExposure: 50,
                atRiskExposure: 50,
            }),
        ];
        const metrics = computePortfolioHealthSeriesMetrics(daily);
        expect(metrics.lowestHealthPct).toBe(50);
        expect(metrics.lowestHealthStreakDays).toBe(2);
        expect(metrics.lowestHealthStreakStart).toBe("2026-07-04");
        expect(metrics.lowestHealthStreakEnd).toBe("2026-07-05");
    });

    it("builds dual series excluding insurer declined from B only", () => {
        const { dailyA, dailyB } = buildDualDailyHealthSeries(
            [
                {
                    snapshotDate: "2026-07-01",
                    totalA: 200,
                    compliantA: 100,
                    atRiskA: 100,
                    // B removes 50 uncovered insurer-declined AR
                    totalB: 150,
                    compliantB: 100,
                    atRiskB: 50,
                },
            ],
            new Map(),
            false
        );

        expect(dailyA[0]!.healthIndex).toBe(50);
        expect(dailyB[0]!.healthIndex).toBeCloseTo(100 / 1.5, 5);
        expect(dailyB[0]!.totalReceivables).toBe(150);
    });

    it("adds without-policy AR to both series when toggle is on", () => {
        const { dailyA, dailyB } = buildDualDailyHealthSeries(
            [
                {
                    snapshotDate: "2026-07-01",
                    totalA: 100,
                    compliantA: 80,
                    atRiskA: 20,
                    totalB: 100,
                    compliantB: 80,
                    atRiskB: 20,
                },
            ],
            new Map([["2026-07-01", 20]]),
            true
        );

        expect(dailyA[0]!.totalReceivables).toBe(120);
        expect(dailyA[0]!.atRiskExposure).toBe(40);
        expect(dailyA[0]!.healthIndex).toBeCloseTo((80 / 120) * 100, 5);
        expect(dailyB[0]!.totalReceivables).toBe(120);
    });

    it("aggregates daily points into monthly averages", () => {
        const monthly = aggregateDailyHealthToMonthly([
            buildDailyHealthPoint({
                snapshotDate: "2026-06-30",
                totalReceivables: 100,
                compliantExposure: 90,
                atRiskExposure: 10,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 200,
                compliantExposure: 100,
                atRiskExposure: 100,
            }),
            buildDailyHealthPoint({
                snapshotDate: "2026-07-02",
                totalReceivables: 100,
                compliantExposure: 50,
                atRiskExposure: 50,
            }),
        ]);

        expect(monthly).toHaveLength(2);
        expect(monthly[0]).toMatchObject({
            month: "2026-06",
            totalReceivables: 100,
        });
        expect(monthly[1]).toMatchObject({
            month: "2026-07",
            totalReceivables: 150,
            compliantExposure: 75,
            atRiskExposure: 75,
        });
    });

    it("builds portfolio health section for A and B", () => {
        const dailyA = [
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 100,
                compliantExposure: 50,
                atRiskExposure: 50,
            }),
        ];
        const dailyB = [
            buildDailyHealthPoint({
                snapshotDate: "2026-07-01",
                totalReceivables: 80,
                compliantExposure: 50,
                atRiskExposure: 30,
            }),
        ];
        const section = buildPortfolioHealthSection(dailyA, dailyB);
        expect(section.seriesA.averageHealthPct).toBe(50);
        expect(section.seriesB.averageHealthPct).toBe(62.5);
        expect(section.monthlyA).toHaveLength(1);
        expect(section.monthlyB).toHaveLength(1);
    });
});

describe("No Coverage pure helpers", () => {
    it("classifies uncovered cohort broader than pending-review card", () => {
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: false,
                exclusionReason: null,
            })
        ).toBe("no_linked_policy");
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: true,
                exclusionReason: "Credit hold",
            })
        ).toBe("credit_hold");
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: true,
                exclusionReason: "Insurer declined",
            })
        ).toBe("insurer_declined");
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: true,
                exclusionReason: "Pending review",
            })
        ).toBe("pending_review");
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: true,
                exclusionReason: "Custom unknown",
            })
        ).toBe("Custom unknown");
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: true,
                exclusionReason: "Other",
            })
        ).toBe("Other");
        expect(
            classifyNoCoverageReason({
                hasLinkedPolicy: true,
                exclusionReason: null,
            })
        ).toBeNull();
        expect(
            isApprovedCoverageCustomer({
                hasLinkedPolicy: true,
                exclusionReason: null,
            })
        ).toBe(true);
        expect(
            isApprovedCoverageCustomer({
                hasLinkedPolicy: true,
                exclusionReason: "Credit hold",
            })
        ).toBe(false);
    });

    it("averages uncovered %/amount and approved-only violation %", () => {
        const section = buildNoCoverageSection([
            {
                snapshotDate: "2026-07-01",
                totalCustomerCount: 10,
                uncoveredCustomerCount: 2,
                uncoveredAmount: 200,
                approvedTotalReceivables: 800,
                approvedTermsBreachAmount: 80,
                amountByReason: {
                    credit_hold: 100,
                    insurer_declined: 100,
                },
                customerCountByReason: {
                    credit_hold: 1,
                    insurer_declined: 1,
                },
                breachAmountByReason: {
                    paymentTerm: 50,
                    reportingBreach: 30,
                },
            },
            {
                snapshotDate: "2026-07-02",
                totalCustomerCount: 10,
                uncoveredCustomerCount: 4,
                uncoveredAmount: 400,
                approvedTotalReceivables: 600,
                approvedTermsBreachAmount: 0,
                amountByReason: {
                    credit_hold: 400,
                },
                customerCountByReason: {
                    credit_hold: 4,
                },
                breachAmountByReason: {
                    paymentTerm: 100,
                },
            },
        ]);

        // (20% + 40%) / 2
        expect(section.averageUncoveredCustomerPct).toBeCloseTo(30, 5);
        expect(section.averageUncoveredAmount).toBe(300);
        expect(section.averageUncoveredCustomerCount).toBe(3);
        expect(section.accountCurrency).toBe("USD");
        // day1 10%, day2 0% → 5%
        expect(section.averageViolationPct).toBeCloseTo(5, 5);
        const creditHold = section.reasons.find(
            (r) => r.reason === "credit_hold"
        );
        expect(creditHold?.averageAmount).toBe(250);
        expect(creditHold?.averageCustomerCount).toBe(2.5);
    });

    it("keeps distinct non-canonical exclusion reasons instead of an Other bucket", () => {
        const section = buildNoCoverageSection([
            {
                snapshotDate: "2026-07-01",
                totalCustomerCount: 10,
                uncoveredCustomerCount: 3,
                uncoveredAmount: 300,
                approvedTotalReceivables: 700,
                approvedTermsBreachAmount: 0,
                amountByReason: {
                    Other: 100,
                    "Manual blacklist": 200,
                },
                customerCountByReason: {
                    Other: 1,
                    "Manual blacklist": 2,
                },
                breachAmountByReason: {},
            },
        ]);

        const other = section.reasons.find((r) => r.reason === "Other");
        const blacklist = section.reasons.find(
            (r) => r.reason === "Manual blacklist"
        );
        expect(other?.averageAmount).toBe(100);
        expect(other?.averageCustomerCount).toBe(1);
        expect(blacklist?.averageAmount).toBe(200);
        expect(blacklist?.averageCustomerCount).toBe(2);
        expect(section.reasons.some((r) => r.reason === "other")).toBe(false);
    });

    it("picks main violation reason by summed breach amount over the range", () => {
        const section = buildNoCoverageSection([
            {
                snapshotDate: "2026-07-01",
                totalCustomerCount: 5,
                uncoveredCustomerCount: 0,
                uncoveredAmount: 0,
                approvedTotalReceivables: 1000,
                approvedTermsBreachAmount: 100,
                amountByReason: {},
                customerCountByReason: {},
                breachAmountByReason: {
                    paymentTerm: 40,
                    reportingBreach: 60,
                },
            },
            {
                snapshotDate: "2026-07-02",
                totalCustomerCount: 5,
                uncoveredCustomerCount: 0,
                uncoveredAmount: 0,
                approvedTotalReceivables: 1000,
                approvedTermsBreachAmount: 200,
                amountByReason: {},
                customerCountByReason: {},
                breachAmountByReason: {
                    paymentTerm: 180,
                    reportingBreach: 20,
                },
            },
        ]);

        // paymentTerm 220 vs reportingBreach 80
        expect(section.mainViolationReason).toBe("paymentTerm");
        expect(section.mainViolationReasonSharePct).toBeCloseTo(
            (220 / 300) * 100,
            5
        );
        expect(section.totalBreachAmount).toBe(300);
    });

    it("adds without-policy cohort into uncovered + no_linked_policy reason", () => {
        const day = applyWithoutPolicyToNoCoverageDay(
            {
                snapshotDate: "2026-07-01",
                totalCustomerCount: 8,
                uncoveredCustomerCount: 2,
                uncoveredAmount: 100,
                approvedTotalReceivables: 700,
                approvedTermsBreachAmount: 0,
                amountByReason: { credit_hold: 100 },
                customerCountByReason: { credit_hold: 2 },
                breachAmountByReason: {},
            },
            { customerCount: 3, amount: 50 },
            true
        );

        expect(day.totalCustomerCount).toBe(11);
        expect(day.uncoveredCustomerCount).toBe(5);
        expect(day.uncoveredAmount).toBe(150);
        expect(day.amountByReason.no_linked_policy).toBe(50);
        expect(day.customerCountByReason.no_linked_policy).toBe(3);
    });

    it("returns null main reason when no breach amounts", () => {
        expect(pickMainViolationReason({})).toEqual({
            reason: null,
            sharePct: 0,
            totalAmount: 0,
        });
    });
});

describe("Utilization pure helpers", () => {
    it("computes size-weighted daily portfolio utilization and guards zero limit", () => {
        expect(computeDailyPortfolioUtilizationPct(80, 100)).toBe(80);
        expect(computeDailyPortfolioUtilizationPct(150, 100)).toBe(150);
        expect(computeDailyPortfolioUtilizationPct(50, 0)).toBeNull();
        expect(computeDailyPortfolioUtilizationPct(0, -1)).toBeNull();
    });

    it("computes size-weighted top-up utilization and guards empty top-ups", () => {
        // weighted usage 0.5*40 + 1.0*60 = 80 over weight 100 → 80%
        expect(computeDailyTopUpUtilizationPct(80, 100)).toBe(80);
        expect(computeDailyTopUpUtilizationPct(10, 0)).toBeNull();
    });

    it("assigns exclusive distribution bins that cover the full range", () => {
        expect(assignUtilizationDistributionBin(0)).toBe("0_10");
        expect(assignUtilizationDistributionBin(9.99)).toBe("0_10");
        expect(assignUtilizationDistributionBin(10)).toBe("10_20");
        expect(assignUtilizationDistributionBin(19.9)).toBe("10_20");
        expect(assignUtilizationDistributionBin(20)).toBe("20_50");
        expect(assignUtilizationDistributionBin(49.9)).toBe("20_50");
        expect(assignUtilizationDistributionBin(50)).toBe("50_75");
        expect(assignUtilizationDistributionBin(74.9)).toBe("50_75");
        expect(assignUtilizationDistributionBin(75)).toBe("75_plus");
        expect(assignUtilizationDistributionBin(200)).toBe("75_plus");
    });

    it("builds distribution percents that sum to ~100% of included customers", () => {
        const { bins, customerCount } = buildUtilizationDistribution([
            { utilizationPct: 5 },
            { utilizationPct: 15 },
            { utilizationPct: 30 },
            { utilizationPct: 60 },
            { utilizationPct: 90 },
        ]);
        expect(customerCount).toBe(5);
        expect(bins.map((b) => b.customerCount)).toEqual([1, 1, 1, 1, 1]);
        const pctSum = bins.reduce((sum, b) => sum + b.customerPct, 0);
        expect(pctSum).toBeCloseTo(100, 5);
    });

    it("averages utilization, % days >100, and peak streak with most-recent tie-break", () => {
        const metrics = computeUtilizationPeriodMetrics([
            {
                snapshotDate: "2026-07-01",
                utilizationPct: 110,
                dclUtilizationPct: 100,
                namedUtilizationPct: 120,
                dclCustomerCount: 1,
                namedCustomerCount: 1,
                dclAr: 50,
                namedAr: 50,
                topUpUtilizationPct: 40,
                activeTopUpCountSum: 2,
                customersWithActiveTopUp: 1,
            },
            {
                snapshotDate: "2026-07-02",
                utilizationPct: 110,
                dclUtilizationPct: 100,
                namedUtilizationPct: 120,
                dclCustomerCount: 1,
                namedCustomerCount: 1,
                dclAr: 50,
                namedAr: 50,
                topUpUtilizationPct: 60,
                activeTopUpCountSum: 4,
                customersWithActiveTopUp: 2,
            },
            {
                snapshotDate: "2026-07-03",
                utilizationPct: 90,
                dclUtilizationPct: 90,
                namedUtilizationPct: 90,
                dclCustomerCount: 1,
                namedCustomerCount: 1,
                dclAr: 50,
                namedAr: 50,
                topUpUtilizationPct: null,
                activeTopUpCountSum: 0,
                customersWithActiveTopUp: 0,
            },
            {
                snapshotDate: "2026-07-04",
                utilizationPct: 110,
                dclUtilizationPct: 100,
                namedUtilizationPct: 120,
                dclCustomerCount: 1,
                namedCustomerCount: 1,
                dclAr: 50,
                namedAr: 50,
                topUpUtilizationPct: 50,
                activeTopUpCountSum: 3,
                customersWithActiveTopUp: 1,
            },
            {
                snapshotDate: "2026-07-05",
                utilizationPct: 110,
                dclUtilizationPct: 100,
                namedUtilizationPct: 120,
                dclCustomerCount: 1,
                namedCustomerCount: 1,
                dclAr: 50,
                namedAr: 50,
                topUpUtilizationPct: null,
                activeTopUpCountSum: 0,
                customersWithActiveTopUp: 0,
            },
            {
                snapshotDate: "2026-07-06",
                utilizationPct: null,
                dclUtilizationPct: null,
                namedUtilizationPct: null,
                dclCustomerCount: 0,
                namedCustomerCount: 0,
                dclAr: 0,
                namedAr: 0,
                topUpUtilizationPct: null,
                activeTopUpCountSum: 0,
                customersWithActiveTopUp: 0,
            },
        ]);

        // util days exclude null limit day → 5 days; avg (110+110+90+110+110)/5
        expect(metrics.averageUtilizationPct).toBeCloseTo(106, 5);
        // 4 of 5 days above 100
        expect(metrics.pctDaysAbove100).toBeCloseTo(80, 5);
        expect(metrics.peakUtilizationPct).toBe(110);
        // two equal 2-day peaks → most recent
        expect(metrics.peakUtilizationStreakDays).toBe(2);
        expect(metrics.peakUtilizationStreakStart).toBe("2026-07-04");
        expect(metrics.peakUtilizationStreakEnd).toBe("2026-07-05");
        // top-up mean over days with top-ups only: (40+60+50)/3
        expect(metrics.averageTopUpUtilizationPct).toBeCloseTo(50, 5);
    });

    it("computes efficiency as health/util and null when util is 0", () => {
        expect(computePolicyEfficiency(90, 60)).toBeCloseTo(1.5, 5);
        expect(computePolicyEfficiency(80, 0)).toBeNull();
    });

    it("computes DCL vs Named shares among covered customers only", () => {
        const footprints = computeDclVsNamedFootprints([
            {
                dclCustomerCount: 2,
                namedCustomerCount: 8,
                dclAr: 200,
                namedAr: 800,
                dclUtilizationPct: 40,
                namedUtilizationPct: 80,
            },
            {
                dclCustomerCount: 4,
                namedCustomerCount: 6,
                dclAr: 400,
                namedAr: 600,
                dclUtilizationPct: 50,
                namedUtilizationPct: 70,
            },
        ]);
        // day1 20%, day2 40% → 30%
        expect(footprints.selfUnderwrittenCustomerPct).toBeCloseTo(30, 5);
        expect(footprints.approvedCustomerPct).toBeCloseTo(70, 5);
        expect(footprints.selfUnderwrittenArSharePct).toBeCloseTo(30, 5);
        expect(footprints.approvedArSharePct).toBeCloseTo(70, 5);
        expect(footprints.selfUnderwrittenAverageAr).toBeCloseTo(300, 5);
        expect(footprints.approvedAverageAr).toBeCloseTo(700, 5);
        expect(footprints.selfUnderwrittenAverageUtilizationPct).toBeCloseTo(
            45,
            5
        );
        expect(footprints.approvedAverageUtilizationPct).toBeCloseTo(75, 5);
    });

    it("computes self vs approved customer % and AR share only (no limit util)", () => {
        const shares = computeSelfVsApprovedShares([
            {
                snapshotDate: "2026-07-01",
                totalCustomerCount: 10,
                uncoveredCustomerCount: 2,
                uncoveredAmount: 200,
                approvedTotalReceivables: 800,
                approvedTermsBreachAmount: 0,
                amountByReason: {},
                customerCountByReason: {},
                breachAmountByReason: {},
            },
            {
                snapshotDate: "2026-07-02",
                totalCustomerCount: 10,
                uncoveredCustomerCount: 4,
                uncoveredAmount: 400,
                approvedTotalReceivables: 600,
                approvedTermsBreachAmount: 0,
                amountByReason: {},
                customerCountByReason: {},
                breachAmountByReason: {},
            },
        ]);
        expect(shares.selfUnderwrittenCustomerPct).toBeCloseTo(30, 5);
        expect(shares.approvedCustomerPct).toBeCloseTo(70, 5);
        // day1 20%, day2 40% → 30%
        expect(shares.selfUnderwrittenArSharePct).toBeCloseTo(30, 5);
        expect(shares.approvedArSharePct).toBeCloseTo(70, 5);
        // day1 200, day2 400 → 300
        expect(shares.selfUnderwrittenAverageAr).toBeCloseTo(300, 5);
        // day1 800, day2 600 → 700
        expect(shares.approvedAverageAr).toBeCloseTo(700, 5);
    });

    it("builds utilization section with DCL/Named footprints and period top-ups", () => {
        const section = buildUtilizationSection({
            daily: [
                {
                    snapshotDate: "2026-07-01",
                    utilizationPct: 50,
                    dclUtilizationPct: 40,
                    namedUtilizationPct: 60,
                    dclCustomerCount: 1,
                    namedCustomerCount: 3,
                    dclAr: 25,
                    namedAr: 75,
                    topUpUtilizationPct: null,
                    activeTopUpCountSum: 0,
                    customersWithActiveTopUp: 0,
                },
            ],
            healthAverageA: 90,
            periodActiveTopUpCount: 5,
            periodCustomersWithTopUp: 3,
            topCustomers: [
                {
                    customerId: 1,
                    customerName: "Acme",
                    usageAmount: 100,
                    utilizationPct: 80,
                },
            ],
            distributionCustomers: [
                { utilizationPct: 5 },
                { utilizationPct: 80 },
            ],
        });

        expect(section.averageUtilizationPct).toBe(50);
        expect(section.efficiencyA).toBeCloseTo(1.8, 5);
        expect(section.efficiencyB).toBeNull();
        expect(section.topCustomers).toHaveLength(1);
        expect(section.distributionCustomerCount).toBe(2);
        expect(section.selfUnderwrittenCustomerPct).toBeCloseTo(25, 5);
        expect(section.approvedArSharePct).toBeCloseTo(75, 5);
        expect(section.selfUnderwrittenAverageUtilizationPct).toBeCloseTo(
            40,
            5
        );
        expect(section.approvedAverageUtilizationPct).toBeCloseTo(60, 5);
        expect(section.periodActiveTopUpCount).toBe(5);
        expect(section.periodCustomersWithTopUp).toBe(3);
        expect(section.daily).toHaveLength(1);
    });
});

describe("creditPortfolioHealthService costs", () => {
    it("computes effective cost as period ÷ avg compliant exposure", () => {
        expect(computeAverageCompliantExposure([])).toBe(0);
        expect(
            computeAverageCompliantExposure([
                { compliantExposure: 100 },
                { compliantExposure: 200 },
            ])
        ).toBe(150);
        expect(computeEffectiveCost(30, 150)).toBeCloseTo(0.2, 5);
    });

    it("guards effective cost when average compliant exposure is zero", () => {
        expect(computeEffectiveCost(10, 0)).toBeNull();
        expect(computeEffectiveCost(0, 0)).toBeNull();
    });

    it("builds costs section from range cost period/monthly with effective cost", () => {
        const rangeCost = computePortfolioRangeCost({
            dayRows: [
                {
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    insurancePolicyId: 9,
                    approvedLimit: 365_000,
                    costCalculationMethod: "Limit",
                    costPercent: 1,
                    excludedFromPolicy: false,
                    outdatedDcl: false,
                    policyExclusionReason: null,
                },
                {
                    snapshotDate: "2026-07-02",
                    customerId: 1,
                    insurancePolicyId: 9,
                    approvedLimit: 730_000,
                    costCalculationMethod: "Limit",
                    costPercent: 1,
                    excludedFromPolicy: false,
                    outdatedDcl: false,
                    policyExclusionReason: null,
                },
            ],
            invoices: [],
            topUpSlices: [],
        });

        const section = buildCostsSection({
            periodCost: rangeCost.periodCost,
            monthly: rangeCost.monthly,
            dailyHealth: [
                { compliantExposure: 100 },
                { compliantExposure: 200 },
            ],
            footprintDaily: [
                {
                    dclCustomerCount: 2,
                    namedCustomerCount: 8,
                    dclAr: 20,
                    namedAr: 80,
                    dclUtilizationPct: 40,
                    namedUtilizationPct: 80,
                },
            ],
            accountCurrency: "ils",
        });

        expect(section.periodCost).toBeCloseTo(30, 5);
        expect(section.daily).toEqual([]);
        expect(section.monthly).toEqual([
            { month: "2026-07", totalCost: expect.closeTo(30, 5) },
        ]);
        expect(section.averageCompliantExposure).toBe(150);
        expect(section.effectiveCost).toBeCloseTo(0.2, 5);
        expect(section.accountCurrency).toBe("ILS");
        expect(section.selfUnderwrittenCustomerPct).toBeCloseTo(20, 5);
        expect(section.approvedCustomerPct).toBeCloseTo(80, 5);
        expect(section.selfUnderwrittenArSharePct).toBeCloseTo(20, 5);
        expect(section.approvedArSharePct).toBeCloseTo(80, 5);
        expect(section.selfUnderwrittenAverageAr).toBeCloseTo(20, 5);
        expect(section.approvedAverageAr).toBeCloseTo(80, 5);
        expect(section.deductiblePct).toBeNull();
    });

    it("sets effectiveCost null when all compliant exposure is zero", () => {
        const section = buildCostsSection({
            periodCost: 5,
            monthly: [{ month: "2026-07", totalCost: 5 }],
            dailyHealth: [{ compliantExposure: 0 }],
            footprintDaily: [],
            accountCurrency: "USD",
        });
        expect(section.periodCost).toBe(5);
        expect(section.effectiveCost).toBeNull();
    });
});

describe("getCreditPortfolioHealth", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(prisma.customerTopUp.findMany).mockResolvedValue([]);
        jest.mocked(prisma.invoice.findMany).mockResolvedValue([]);
    });

    it("returns dual Health + No Coverage + Utilization + Costs sections from CPT aggregates", async () => {
        jest.mocked(prisma.account.findUnique).mockResolvedValue({
            currency: "ILS",
        } as any);

        const healthRows = [
            {
                snapshot_date: new Date("2026-07-01T00:00:00.000Z"),
                total_a: 100,
                compliant_a: 90,
                at_risk_a: 10,
                total_b: 90,
                compliant_b: 90,
                at_risk_b: 0,
            },
            {
                snapshot_date: new Date("2026-07-03T00:00:00.000Z"),
                total_a: 100,
                compliant_a: 60,
                at_risk_a: 40,
                total_b: 100,
                compliant_b: 60,
                at_risk_b: 40,
            },
        ];
        const noCoverageRows = [
            {
                snapshot_date: new Date("2026-07-01T00:00:00.000Z"),
                total_customers: 10,
                uncovered_customers: 2,
                uncovered_amount: 20,
                approved_ar: 80,
                approved_breach: 8,
            },
            {
                snapshot_date: new Date("2026-07-03T00:00:00.000Z"),
                total_customers: 10,
                uncovered_customers: 4,
                uncovered_amount: 40,
                approved_ar: 60,
                approved_breach: 0,
            },
        ];
        const reasonRows = [
            {
                snapshot_date: new Date("2026-07-01T00:00:00.000Z"),
                reason_key: "credit_hold",
                customer_count: 2,
                amount: 20,
            },
            {
                snapshot_date: new Date("2026-07-03T00:00:00.000Z"),
                reason_key: "insurer_declined",
                customer_count: 4,
                amount: 40,
            },
        ];
        const breachRows = [
            {
                snapshot_date: new Date("2026-07-01T00:00:00.000Z"),
                reason_key: "paymentTerm",
                amount: 8,
            },
        ];
        const utilizationRows = [
            {
                snapshot_date: new Date("2026-07-01T00:00:00.000Z"),
                approved_usage_sum: 80,
                approved_effective_limit_sum: 100,
                dcl_usage_sum: 20,
                dcl_effective_limit_sum: 50,
                dcl_customer_count: 1,
                dcl_ar_sum: 30,
                named_usage_sum: 60,
                named_effective_limit_sum: 50,
                named_customer_count: 3,
                named_ar_sum: 70,
                top_up_weighted_usage_sum: 20,
                top_up_total_sum: 40,
                active_top_up_count_sum: 2,
                customers_with_active_top_up: 1,
            },
            {
                snapshot_date: new Date("2026-07-03T00:00:00.000Z"),
                approved_usage_sum: 120,
                approved_effective_limit_sum: 100,
                dcl_usage_sum: 40,
                dcl_effective_limit_sum: 40,
                dcl_customer_count: 2,
                dcl_ar_sum: 40,
                named_usage_sum: 80,
                named_effective_limit_sum: 60,
                named_customer_count: 2,
                named_ar_sum: 60,
                top_up_weighted_usage_sum: 0,
                top_up_total_sum: 0,
                active_top_up_count_sum: 0,
                customers_with_active_top_up: 0,
            },
        ];
        const costRows = [
            {
                snapshot_date: new Date("2026-07-01T00:00:00.000Z"),
                customer_id: 1,
                insurance_policy_id: 9,
                approved_limit: 24000,
                usage_amount: 0,
                approved_limit_currency: "ILS",
                excluded_from_policy: false,
                outdated_dcl: false,
                cost_calculation_method: "Limit",
                cost_percent: 0.05,
                policy_exclusion_reason: null,
            },
            {
                snapshot_date: new Date("2026-07-03T00:00:00.000Z"),
                customer_id: 1,
                insurance_policy_id: 9,
                approved_limit: 36000,
                usage_amount: 0,
                approved_limit_currency: "ILS",
                excluded_from_policy: false,
                outdated_dcl: false,
                cost_calculation_method: "Limit",
                cost_percent: 0.05,
                policy_exclusion_reason: null,
            },
        ];
        const topCustomers = [
            {
                customer_id: 7,
                usage_amount: 50,
                effective_usage_pct: 90,
                effective_approved_limit: 55,
                person_name: null,
                company_name: "Top Co",
            },
        ];
        const distributionRows = [
            { customer_id: 1, utilization_pct: 5 },
            { customer_id: 2, utilization_pct: 80 },
        ];

        jest.mocked(prisma.customerTopUp.findMany).mockResolvedValue([]);
        jest.mocked(prisma.$queryRaw).mockImplementation((async (query: any) => {
            const sql = String(query?.strings?.join?.("") ?? query ?? "");
            if (sql.includes("compliant_a")) {
                return healthRows as any;
            }
            if (sql.includes("uncovered_customers")) {
                return noCoverageRows as any;
            }
            if (sql.includes("reason_key") && sql.includes("customer_count")) {
                return reasonRows as any;
            }
            if (sql.includes("jsonb_each")) {
                return breachRows as any;
            }
            if (sql.includes("approved_usage_sum")) {
                return utilizationRows as any;
            }
            if (
                sql.includes("cost_calculation_method") &&
                sql.includes("cost_percent")
            ) {
                return costRows as any;
            }
            if (sql.includes("company_name") && sql.includes("usage_amount")) {
                return topCustomers as any;
            }
            if (sql.includes("utilization_pct")) {
                return distributionRows as any;
            }
            return [];
        }) as any);

        const result = await getCreditPortfolioHealth(1001, {
            from: "2026-07-01",
            to: "2026-07-10",
            includeNoPolicyExposure: false,
        });

        expect("error" in result).toBe(false);
        if ("error" in result) {
            return;
        }
        // Missing 2026-07-02 → denominator is available days only (2 of 10)
        expect(result.daysAvailable).toBe(2);
        expect(result.daysInRange).toBe(10);
        expect(result.portfolioHealth).not.toBeNull();
        expect(result.portfolioHealth!.seriesA.averageHealthPct).toBe(75);
        expect(result.portfolioHealth!.seriesA.lowestHealthPct).toBe(60);
        expect(result.portfolioHealth!.seriesA.lowestHealthStreakDays).toBe(1);
        expect(result.portfolioHealth!.seriesA.lowestHealthStreakStart).toBe(
            "2026-07-03"
        );
        expect(result.portfolioHealth!.seriesA.lowestHealthStreakEnd).toBe(
            "2026-07-03"
        );
        expect(result.portfolioHealth!.seriesA.pctDaysBelow85).toBe(50);
        expect(result.portfolioHealth!.seriesB.averageHealthPct).toBeCloseTo(
            (100 + 60) / 2,
            5
        );
        expect(result.noCoverage).not.toBeNull();
        expect(result.noCoverage!.averageUncoveredCustomerPct).toBeCloseTo(
            30,
            5
        );
        expect(result.noCoverage!.averageUncoveredAmount).toBe(30);
        expect(result.noCoverage!.accountCurrency).toBe("ILS");
        expect(result.noCoverage!.averageViolationPct).toBeCloseTo(5, 5);
        expect(result.noCoverage!.mainViolationReason).toBe("paymentTerm");
        expect(result.noCoverage!.mainViolationReasonSharePct).toBe(100);
        expect(result.utilization).not.toBeNull();
        // (80% + 120%) / 2
        expect(result.utilization!.averageUtilizationPct).toBeCloseTo(100, 5);
        expect(result.utilization!.pctDaysAbove100).toBe(50);
        expect(result.utilization!.peakUtilizationPct).toBe(120);
        expect(result.utilization!.peakUtilizationStreakDays).toBe(1);
        expect(result.utilization!.peakUtilizationStreakStart).toBe(
            "2026-07-03"
        );
        expect(result.utilization!.peakUtilizationStreakEnd).toBe("2026-07-03");
        expect(result.utilization!.averageTopUpUtilizationPct).toBe(50);
        expect(result.utilization!.topCustomers[0]?.customerName).toBe("Top Co");
        expect(result.utilization!.distributionCustomerCount).toBe(2);
        expect(result.utilization!.efficiencyA).toBeCloseTo(75 / 100, 5);
        expect(result.utilization!.efficiencyB).toBeNull();
        expect(result.utilization!.periodActiveTopUpCount).toBe(0);
        expect(result.utilization!.periodCustomersWithTopUp).toBe(0);
        expect(result.utilization!.daily).toHaveLength(2);
        // day1 DCL 25% of covered cust, day2 50% → 37.5%
        expect(result.utilization!.selfUnderwrittenCustomerPct).toBeCloseTo(
            37.5,
            5
        );
        expect(result.costs).not.toBeNull();
        expect(result.costs!.accountCurrency).toBe("ILS");
        // Limit day-slices: (24000*0.05 + 36000*0.05)/100/365 = 30/365
        expect(result.costs!.periodCost).toBeCloseTo(30 / 365, 8);
        expect(result.costs!.daily).toEqual([]);
        expect(result.costs!.monthly).toEqual([
            { month: "2026-07", totalCost: expect.closeTo(30 / 365, 8) },
        ]);
        // avg compliant (90+60)/2 = 75; effective = (30/365)/75
        expect(result.costs!.effectiveCost).toBeCloseTo(30 / 365 / 75, 8);
        expect(result.costs!.deductiblePct).toBeNull();
        expect(result.costs!.selfUnderwrittenCustomerPct).toBeCloseTo(37.5, 5);
        expect(prisma.customer.findMany).not.toHaveBeenCalled();
        expect(prisma.invoice.findMany).toHaveBeenCalled();
    });

    it("returns empty Health and No Coverage when BU scope has no customers", async () => {
        jest.mocked(prisma.customer.findMany).mockResolvedValue([]);
        jest.mocked(prisma.account.findUnique).mockResolvedValue({
            currency: "USD",
        } as any);

        const result = await getCreditPortfolioHealth(1001, {
            from: "2026-07-01",
            to: "2026-07-10",
            businessUnitFilter: { business_unit_id: 55 },
            includeNoPolicyExposure: false,
        });

        expect(result).toMatchObject({
            daysAvailable: 0,
            daysInRange: 10,
        });
        if ("error" in result) {
            return;
        }
        expect(result.portfolioHealth?.dailyA).toEqual([]);
        expect(result.noCoverage?.averageUncoveredAmount).toBe(0);
        expect(result.utilization?.averageUtilizationPct).toBe(0);
        expect(result.utilization?.topCustomers).toEqual([]);
        expect(result.costs?.periodCost).toBe(0);
        expect(result.costs?.effectiveCost).toBeNull();
        expect(result.costs?.accountCurrency).toBe("USD");
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
});
