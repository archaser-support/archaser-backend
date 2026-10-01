import {
    attributeAmountsToCreditPoolRoots,
    attributeInvoiceCustomerIdsToCreditPoolRoots,
    attributeListsToCreditPoolRoots,
    expandCreditPoolRootsToMembers,
    expandRootIdSetToPoolMembers,
    listDescendantCustomerIds,
    syncCreditPoolPolicyTrendsAfterParentChange,
} from "@archaser/credit-insurance-domain";

type CustomerRow = {
    id: number;
    account_id: number;
    parent_customer_id: number | null;
};

function createPoolMemoryDb(customers: CustomerRow[]) {
    return {
        customer: {
            findUnique: jest.fn(
                async ({
                    where,
                    select,
                }: {
                    where: { id: number };
                    select?: Record<string, boolean>;
                }) => {
                    const row = customers.find((c) => c.id === where.id);
                    if (!row) {
                        return null;
                    }
                    if (!select) {
                        return row;
                    }
                    const out: Record<string, unknown> = {};
                    for (const key of Object.keys(select)) {
                        out[key] = (row as Record<string, unknown>)[key];
                    }
                    return out;
                }
            ),
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        account_id: number;
                        parent_customer_id: { in: number[] };
                    };
                }) =>
                    customers
                        .filter(
                            (c) =>
                                c.account_id === where.account_id &&
                                c.parent_customer_id != null &&
                                where.parent_customer_id.in.includes(
                                    c.parent_customer_id
                                )
                        )
                        .map((c) => ({ id: c.id }))
            ),
        },
        invoice: {
            aggregate: jest.fn(async () => ({
                _min: { invoice_date: null },
            })),
        },
        invoicePayment: {
            aggregate: jest.fn(async () => ({
                _min: { payment_date: null },
            })),
        },
    };
}

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

    it("expandCreditPoolRootsToMembers includes nested descendants", async () => {
        const db = createPoolMemoryDb([
            { id: 1, account_id: 10, parent_customer_id: null },
            { id: 2, account_id: 10, parent_customer_id: 1 },
            { id: 3, account_id: 10, parent_customer_id: 2 },
            { id: 4, account_id: 10, parent_customer_id: null },
        ]);

        await expect(
            listDescendantCustomerIds(1, 10, db as never)
        ).resolves.toEqual([2, 3]);

        const attribution = await expandCreditPoolRootsToMembers(
            10,
            [1, 4],
            db as never
        );
        expect(attribution.memberIds.sort((a, b) => a - b)).toEqual([
            1, 2, 3, 4,
        ]);
        expect(attribution.rootByMemberId.get(3)).toBe(1);
        expect(attribution.rootByMemberId.get(4)).toBe(4);
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

    it("rewrites CDP for the same CPT range and fails closed on CDP errors", async () => {
        const db = createPoolMemoryDb([
            { id: 1, account_id: 10, parent_customer_id: null },
            { id: 2, account_id: 10, parent_customer_id: 1 },
        ]);
        const from = new Date(Date.UTC(2026, 0, 1));
        db.invoice.aggregate = jest.fn(async () => ({
            _min: { invoice_date: from },
        }));

        const rewriteCpt = jest.fn(async () => ({
            daysRewritten: 3,
            skipped: false,
        }));
        const rewriteCdp = jest.fn(async () => 3);

        const ok = await syncCreditPoolPolicyTrendsAfterParentChange({
            accountId: 10,
            remirroredRoots: [1],
            dbClient: db as never,
            rewriteCustomerAsOfRange: rewriteCpt as never,
            rewriteCreditDashboardForRange: rewriteCdp,
            skipPoolTrendOverlay: true,
            historyMode: "full_sync",
            skipAsyncHistoryJob: true,
        });

        expect(rewriteCpt).toHaveBeenCalledTimes(1);
        expect(rewriteCdp).toHaveBeenCalledTimes(1);
        expect(ok.daysRewritten).toBe(3);
        expect(ok.creditDashboardDaysRewritten).toBe(3);
        expect(ok.customerIds.sort((a, b) => a - b)).toEqual([1, 2]);
        const cdpArgs = rewriteCdp.mock.calls[0][0] as {
            fromDate: Date;
            toDate: Date;
        };
        expect(cdpArgs.fromDate.getTime()).toBe(from.getTime());
        expect(cdpArgs.toDate.getTime()).toBe(ok.toDate.getTime());

        const failingCdp = jest.fn(async () => {
            throw new Error("cdp writer failed");
        });
        await expect(
            syncCreditPoolPolicyTrendsAfterParentChange({
                accountId: 10,
                remirroredRoots: [1],
                dbClient: db as never,
                rewriteCustomerAsOfRange: rewriteCpt as never,
                rewriteCreditDashboardForRange: failingCdp,
                skipPoolTrendOverlay: true,
                historyMode: "full_sync",
                skipAsyncHistoryJob: true,
            })
        ).rejects.toThrow("cdp writer failed");
    });
});
