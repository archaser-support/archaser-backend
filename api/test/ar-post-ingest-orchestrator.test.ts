import {
    buildReplayEvents,
    runArPostIngestForCustomers,
    simulateCustomerArReplay,
    sortReplayEvents,
    type ArPostIngestDeps,
    type ReplayEvent,
} from "@archaser/cron-jobs";
import { triggerPostImportOverdueMetrics } from "../src/credit-insurance/domain/postImportOverdueMetrics";

jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCustomerInsuranceFields", () => ({
    syncCustomerInsuranceFields: jest.fn().mockResolvedValue(undefined),
}));

import { syncCustomerInsuranceFields } from "@archaser/credit-insurance-domain";

function d(iso: string): Date {
    const [y, mo, day] = iso.split("-").map(Number);
    return new Date(y, mo - 1, day);
}

function createDeps(
    overrides: Partial<ArPostIngestDeps> = {}
): ArPostIngestDeps & {
    calls: string[];
} {
    const calls: string[] = [];
    const deps: ArPostIngestDeps & { calls: string[] } = {
        calls,
        accountHasCreditInsurance: jest.fn(async () => true),
        replayCustomer: jest.fn(async ({ customerId }) => {
            calls.push(`replay:${customerId}`);
        }),
        applyMaturity: jest.fn(async () => {
            calls.push("maturity");
        }),
        processOverdueCustomer: jest.fn(async (customerId) => {
            calls.push(`overdue:${customerId}`);
        }),
        liveRefreshCustomer: jest.fn(async (customerId) => {
            calls.push(`live:${customerId}`);
        }),
        enqueueAsOfRewrite: jest.fn(async () => {
            calls.push("as_of");
        }),
        logError: jest.fn(),
        ...overrides,
    };
    return deps;
}

describe("importArReplayService (pure)", () => {
    it("sorts by date with invoice_open before payment_apply on the same day", () => {
        const events: ReplayEvent[] = [
            {
                type: "payment_apply",
                date: d("2026-01-01"),
                payload: {
                    id: 1,
                    invoiceNumber: "INV-1",
                    paymentDate: d("2026-01-01"),
                    amount: 50,
                    customerAmount: 50,
                },
            },
            {
                type: "invoice_open",
                date: d("2026-01-01"),
                payload: {
                    invoiceNumber: "INV-1",
                    invoiceDate: d("2026-01-01"),
                    netAmount: 250,
                    customerNetAmount: 250,
                },
            },
        ];

        const sorted = sortReplayEvents(events);
        expect(sorted[0]?.type).toBe("invoice_open");
        expect(sorted[1]?.type).toBe("payment_apply");
    });

    it("stamps assessed limits chronologically for open invoices", () => {
        const { invoices } = simulateCustomerArReplay(
            { approvedLimit: 1_000 },
            [
                {
                    invoiceNumber: "INV-1",
                    invoiceDate: d("2026-01-01"),
                    netAmount: 600,
                    customerNetAmount: 600,
                },
                {
                    invoiceNumber: "INV-2",
                    invoiceDate: d("2026-01-05"),
                    netAmount: 500,
                    customerNetAmount: 500,
                },
            ],
            []
        );

        const inv1 = invoices.find((i) => i.invoiceNumber === "INV-1");
        const inv2 = invoices.find((i) => i.invoiceNumber === "INV-2");
        expect(inv1?.limitAssessedAmount).toBe(600);
        expect(inv2?.limitAssessedAmount).toBe(400);
    });

    it("buildReplayEvents merges and sorts invoices and payments", () => {
        const events = buildReplayEvents(
            [
                {
                    invoiceNumber: "INV-2",
                    invoiceDate: d("2026-01-04"),
                    netAmount: 100,
                    customerNetAmount: 100,
                },
            ],
            [
                {
                    id: 10,
                    invoiceNumber: "INV-1",
                    paymentDate: d("2026-01-03"),
                    amount: 150,
                    customerAmount: 150,
                },
            ]
        );
        expect(events).toHaveLength(2);
        expect(events[0]?.type).toBe("payment_apply");
        expect(events[1]?.type).toBe("invoice_open");
    });
});

describe("triggerPostImportOverdueMetrics", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (syncCustomerInsuranceFields as jest.Mock).mockResolvedValue(undefined);
    });

    it("runs customer insurance sync follow-up for each provided customer id", async () => {
        await triggerPostImportOverdueMetrics([10, 20, 10]);

        expect(syncCustomerInsuranceFields).toHaveBeenCalledTimes(2);
        expect(syncCustomerInsuranceFields).toHaveBeenNthCalledWith(1, 10, {
            runFollowUpEffects: true,
        });
        expect(syncCustomerInsuranceFields).toHaveBeenNthCalledWith(2, 20, {
            runFollowUpEffects: true,
        });
    });

    it("continues after a per-customer failure", async () => {
        (syncCustomerInsuranceFields as jest.Mock)
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce(undefined);

        const result = await triggerPostImportOverdueMetrics([1, 2]);

        expect(result.customersAttempted).toBe(2);
        expect(result.errors).toEqual([
            { customerId: 1, message: "boom" },
        ]);
        expect(syncCustomerInsuranceFields).toHaveBeenCalledTimes(2);
    });
});

describe("runArPostIngestForCustomers", () => {
    it("collection-only: runs Process Overdue without replay/live; credit steps skipped", async () => {
        const deps = createDeps({
            accountHasCreditInsurance: jest.fn(async () => false),
        });

        const result = await runArPostIngestForCustomers(
            {
                accountId: 9,
                customerIds: [1, 2],
                runReplay: true,
                runMaturity: true,
                runLiveRefresh: true,
                enqueueAsOfRewrite: true,
                asOfRewrite: { importType: "Invoice", entityIds: [100] },
            },
            deps
        );

        expect(result).toEqual({
            skipped: true,
            skipReason: "no_credit_insurance",
            errors: [],
        });
        expect(deps.calls).toEqual(["overdue:1", "overdue:2"]);
        expect(deps.replayCustomer).not.toHaveBeenCalled();
        expect(deps.applyMaturity).not.toHaveBeenCalled();
        expect(deps.liveRefreshCustomer).not.toHaveBeenCalled();
        expect(deps.enqueueAsOfRewrite).not.toHaveBeenCalled();
    });

    it("runs steps in order: replay → maturity → overdue → live refresh → as-of", async () => {
        const deps = createDeps();

        await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [11, 22],
                runReplay: true,
                runMaturity: true,
                runLiveRefresh: true,
                enqueueAsOfRewrite: true,
                asOfRewrite: { importType: "Payment", entityIds: [501] },
                maturityAsOf: d("2026-07-01"),
            },
            deps
        );

        expect(deps.calls).toEqual([
            "replay:11",
            "replay:22",
            "maturity",
            "overdue:11",
            "overdue:22",
            "live:11",
            "live:22",
            "as_of",
        ]);
        expect(deps.applyMaturity).toHaveBeenCalledWith(
            1,
            d("2026-07-01")
        );
        expect(deps.enqueueAsOfRewrite).toHaveBeenCalledWith({
            accountId: 1,
            importType: "Payment",
            entityIds: [501],
            customerIds: [11, 22],
        });
    });

    it("honors flags — only enabled steps run (overdue defaults on)", async () => {
        const deps = createDeps();

        await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [5],
                runReplay: true,
                runLiveRefresh: true,
            },
            deps
        );

        expect(deps.calls).toEqual(["replay:5", "overdue:5", "live:5"]);
        expect(deps.applyMaturity).not.toHaveBeenCalled();
        expect(deps.enqueueAsOfRewrite).not.toHaveBeenCalled();
    });

    it("skips Process Overdue when runProcessOverdue is false", async () => {
        const deps = createDeps();

        await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [5],
                runReplay: true,
                runProcessOverdue: false,
                runLiveRefresh: true,
            },
            deps
        );

        expect(deps.calls).toEqual(["replay:5", "live:5"]);
        expect(deps.processOverdueCustomer).not.toHaveBeenCalled();
    });

    it("dry-run skips overdue and all other side effects", async () => {
        const deps = createDeps();

        const result = await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [1],
                dryRun: true,
                runReplay: true,
                runMaturity: true,
                runProcessOverdue: true,
                runLiveRefresh: true,
                enqueueAsOfRewrite: true,
                asOfRewrite: { importType: "Invoice", entityIds: [1] },
            },
            deps
        );

        expect(result).toEqual({
            skipped: true,
            skipReason: "dry_run",
            errors: [],
        });
        expect(deps.calls).toEqual([]);
        expect(deps.processOverdueCustomer).not.toHaveBeenCalled();
    });

    it("processes customers sequentially for replay, overdue, and live refresh", async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const order: string[] = [];

        const track = async (label: string) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            order.push(label);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
        };

        const deps = createDeps({
            replayCustomer: jest.fn(async ({ customerId }) => {
                await track(`replay:${customerId}`);
            }),
            processOverdueCustomer: jest.fn(async (customerId) => {
                await track(`overdue:${customerId}`);
            }),
            liveRefreshCustomer: jest.fn(async (customerId) => {
                await track(`live:${customerId}`);
            }),
        });

        await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [1, 2, 3],
                runReplay: true,
                runLiveRefresh: true,
            },
            deps
        );

        expect(order).toEqual([
            "replay:1",
            "replay:2",
            "replay:3",
            "overdue:1",
            "overdue:2",
            "overdue:3",
            "live:1",
            "live:2",
            "live:3",
        ]);
        expect(maxInFlight).toBe(1);
    });

    it("best-effort: continues after overdue failure and still runs live refresh", async () => {
        const deps = createDeps();
        (deps.processOverdueCustomer as jest.Mock).mockImplementation(
            async (customerId: number) => {
                deps.calls.push(`overdue:${customerId}`);
                if (customerId === 2) {
                    throw new Error("overdue boom");
                }
            }
        );

        const result = await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [1, 2, 3],
                runReplay: true,
                runMaturity: true,
                runLiveRefresh: true,
                enqueueAsOfRewrite: true,
                asOfRewrite: { importType: "Invoice", entityIds: [9] },
            },
            deps
        );

        expect(result.skipped).toBe(false);
        expect(deps.calls).toEqual([
            "replay:1",
            "replay:2",
            "replay:3",
            "maturity",
            "overdue:1",
            "overdue:2",
            "overdue:3",
            "live:1",
            "live:2",
            "live:3",
            "as_of",
        ]);
        expect(result.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    step: "process_overdue",
                    customerId: 2,
                    message: "overdue boom",
                }),
            ])
        );
        expect(deps.logError).toHaveBeenCalled();
    });

    it("best-effort: continues after a mid-loop failure and does not throw", async () => {
        const calls: string[] = [];
        const deps = createDeps({
            replayCustomer: jest.fn(async ({ customerId }) => {
                calls.push(`replay:${customerId}`);
                if (customerId === 2) {
                    throw new Error("replay boom");
                }
            }),
            processOverdueCustomer: jest.fn(async (customerId) => {
                calls.push(`overdue:${customerId}`);
            }),
            liveRefreshCustomer: jest.fn(async (customerId) => {
                calls.push(`live:${customerId}`);
                if (customerId === 1) {
                    throw new Error("live boom");
                }
            }),
            applyMaturity: jest.fn(async () => {
                calls.push("maturity");
            }),
            enqueueAsOfRewrite: jest.fn(async () => {
                calls.push("as_of");
            }),
        });

        const result = await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [1, 2, 3],
                runReplay: true,
                runMaturity: true,
                runLiveRefresh: true,
                enqueueAsOfRewrite: true,
                asOfRewrite: { importType: "Invoice", entityIds: [9] },
            },
            deps
        );

        expect(result.skipped).toBe(false);
        expect(calls).toEqual([
            "replay:1",
            "replay:2",
            "replay:3",
            "maturity",
            "overdue:1",
            "overdue:2",
            "overdue:3",
            "live:1",
            "live:2",
            "live:3",
            "as_of",
        ]);
        expect(result.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    step: "replay",
                    customerId: 2,
                    message: "replay boom",
                }),
                expect.objectContaining({
                    step: "live_refresh",
                    customerId: 1,
                    message: "live boom",
                }),
            ])
        );
        expect(deps.logError).toHaveBeenCalled();
    });

    it("records as-of enqueue config errors without throwing", async () => {
        const deps = createDeps();

        const result = await runArPostIngestForCustomers(
            {
                accountId: 1,
                customerIds: [1],
                runProcessOverdue: false,
                enqueueAsOfRewrite: true,
            },
            deps
        );

        expect(result.skipped).toBe(false);
        expect(deps.enqueueAsOfRewrite).not.toHaveBeenCalled();
        expect(result.errors).toEqual([
            {
                step: "as_of_enqueue",
                message:
                    "enqueueAsOfRewrite requires asOfRewrite.importType and entityIds",
            },
        ]);
    });
});
