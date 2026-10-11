import {
    attributeAmountsToCreditPoolRoots,
    attributeInvoiceCustomerIdsToCreditPoolRoots,
    attributeListsToCreditPoolRoots,
    expandRootIdSetToPoolMembers,
    syncCreditPoolPolicyTrendsAfterParentChange,
} from "@archaser/credit-insurance-domain";

describe("portfolio/CDP descendant invoice attribution", () => {
    it("rolls child invoice amounts onto the shell root", () => {
        const rootByMemberId = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [4, 4],
        ]);
        // Shell root 1 has no invoices; children hold AR + terms breach.
        const openAr = new Map([
            [2, 8_000],
            [3, 4_500],
            [4, 1_000],
        ]);
        const termsBreach = new Map([
            [2, 3_000],
            [3, 500],
        ]);

        const attributedAr = attributeAmountsToCreditPoolRoots(
            openAr,
            rootByMemberId,
            { allowedRootIds: new Set([1, 4]) }
        );
        const attributedBreach = attributeAmountsToCreditPoolRoots(
            termsBreach,
            rootByMemberId,
            { allowedRootIds: new Set([1, 4]) }
        );

        expect(attributedAr.get(1)).toBe(12_500);
        expect(attributedAr.get(4)).toBe(1_000);
        expect(attributedAr.has(2)).toBe(false);
        expect(attributedBreach.get(1)).toBe(3_500);
        expect(attributedBreach.has(2)).toBe(false);
    });

    it("drops amounts whose root is outside the allowed cohort", () => {
        const rootByMemberId = new Map([
            [10, 10],
            [11, 10],
            [20, 20],
        ]);
        const amounts = new Map([
            [11, 100],
            [20, 50],
        ]);
        const attributed = attributeAmountsToCreditPoolRoots(
            amounts,
            rootByMemberId,
            { allowedRootIds: new Set([10]) }
        );
        expect(attributed.get(10)).toBe(100);
        expect(attributed.has(20)).toBe(false);
    });

    it("expands insured roots to pool members for invoice filters", () => {
        const rootByMemberId = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [9, 9],
        ]);
        expect(
            [...expandRootIdSetToPoolMembers([1], rootByMemberId)].sort(
                (a, b) => a - b
            )
        ).toEqual([1, 2, 3]);
        expect(
            [...expandRootIdSetToPoolMembers([1, 9], rootByMemberId)].sort(
                (a, b) => a - b
            )
        ).toEqual([1, 2, 3, 9]);
    });

    it("remaps descendant invoice customer ids onto the shell root", () => {
        const rootByMemberId = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [4, 4],
        ]);
        const lines = [
            { invoiceId: 10, customerId: 2, amount: 3_000 },
            { invoiceId: 11, customerId: 3, amount: 500 },
            { invoiceId: 12, customerId: 4, amount: 100 },
            { invoiceId: 13, customerId: 1, amount: 0 },
        ];
        const remapped = attributeInvoiceCustomerIdsToCreditPoolRoots(
            lines,
            rootByMemberId,
            { allowedRootIds: new Set([1]) }
        );
        expect(remapped.map((row) => row.customerId)).toEqual([1, 1, 4, 1]);
        expect(remapped[0].invoiceId).toBe(10);
        expect(remapped[2].customerId).toBe(4);
    });

    it("merges at-risk invoice lists onto pool roots", () => {
        const rootByMemberId = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
        ]);
        const byCustomer = new Map([
            [2, [{ outstanding: 3_000, capacityGapAmount: 500, hasTermsBreach: true }]],
            [3, [{ outstanding: 1_000, capacityGapAmount: 0, hasTermsBreach: false }]],
            [9, [{ outstanding: 50, capacityGapAmount: 0, hasTermsBreach: false }]],
        ]);
        const attributed = attributeListsToCreditPoolRoots(
            byCustomer,
            rootByMemberId,
            { allowedRootIds: new Set([1]) }
        );
        expect(attributed.get(1)).toHaveLength(2);
        expect(attributed.get(1)?.[0].outstanding).toBe(3_000);
        expect(attributed.get(1)?.[1].outstanding).toBe(1_000);
        expect(attributed.has(2)).toBe(false);
        expect(attributed.has(9)).toBe(false);
    });

    it("syncCreditPoolPolicyTrendsAfterParentChange no-ops when no roots", async () => {
        const result = await syncCreditPoolPolicyTrendsAfterParentChange({
            accountId: 10,
            remirroredRoots: [],
        });
        expect(result.daysRewritten).toBe(0);
        expect(result.creditDashboardDaysRewritten).toBe(0);
        expect(result.fromDate).toBeNull();
        expect(result.customerIds).toEqual([]);
    });

});
