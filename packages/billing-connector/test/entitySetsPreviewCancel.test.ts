import {
    mergeEntitySetsPatch,
    normalizeEntitySetName,
    parseEntitySetsMap,
    resolveEntityCollectionPath,
} from "../src/services/billingConnectorEntitySets";
import {
    allEnabledEntitiesPreviewPassed,
    clearPreviewPass,
    clearPreviewPasses,
    computeEntityPreviewPassed,
    parsePreviewPassesMap,
    setPreviewPass,
    setPreviewPasses,
} from "../src/services/billingConnectorPreviewPasses";
import {
    clearConnectorSyncCancel,
    isConnectorSyncCancelRequested,
    requestConnectorSyncCancel,
    resetConnectorSyncCancelRegistryForTests,
} from "../src/sync/connectorSyncCancelRegistry";

describe("billingConnectorEntitySets", () => {
    it("parses and merges entity set overrides", () => {
        const existing = parseEntitySetsMap({
            Payment: "TOTARPAY",
            Invoice: "CINVOICES",
        });
        const merged = mergeEntitySetsPatch(existing, {
            Payment: "IDG_ARFNCITEMS4",
            Invoice: null,
        });
        expect(merged).toEqual({ Payment: "IDG_ARFNCITEMS4" });
    });

    it("rejects invalid entity set names", () => {
        expect(() => normalizeEntitySetName("bad name")).toThrow(
            /Invalid Priority table name/
        );
    });

    it("resolves collection path with override", () => {
        expect(
            resolveEntityCollectionPath("Payment", {
                Payment: "IDG_ARFNCITEMS4",
            })
        ).toBe("IDG_ARFNCITEMS4");
        expect(resolveEntityCollectionPath("Payment", {})).toBe("TOTARPAY");
    });
});

describe("billingConnectorPreviewPasses", () => {
    it("parses valid pass entries and ignores junk", () => {
        const map = parsePreviewPassesMap({
            Customer: {
                passed: true,
                completed_at: "2026-08-04T00:00:00.000Z",
            },
            Invoice: { passed: false },
            bogus: { passed: true, completed_at: "2026-08-04T00:00:00.000Z" },
        });
        expect(map).toEqual({
            Customer: {
                passed: true,
                completed_at: "2026-08-04T00:00:00.000Z",
            },
        });
    });

    it("clears one or many entities", () => {
        const base = setPreviewPasses(
            {},
            [
                { importType: "Customer", passed: true },
                { importType: "Invoice", passed: true },
                { importType: "Payment", passed: false },
            ],
            new Date("2026-08-04T12:00:00.000Z")
        );
        expect(clearPreviewPass(base, "Invoice").Invoice).toBeUndefined();
        expect(
            clearPreviewPasses(base, ["Customer", "Payment"]).Invoice?.passed
        ).toBe(true);
    });

    it("requires every enabled entity to have passed:true", () => {
        const passes = {
            Customer: {
                passed: true,
                completed_at: "2026-08-04T00:00:00.000Z",
            },
            Invoice: {
                passed: true,
                completed_at: "2026-08-04T00:00:00.000Z",
            },
        };
        expect(
            allEnabledEntitiesPreviewPassed(["Customer", "Invoice"], passes)
        ).toBe(true);
        expect(
            allEnabledEntitiesPreviewPassed(
                ["Customer", "Invoice", "Payment"],
                passes
            )
        ).toBe(false);
        expect(
            allEnabledEntitiesPreviewPassed(
                ["Customer", "Invoice"],
                setPreviewPass(passes, "Invoice", false)
            )
        ).toBe(false);
    });

    it("computes entity pass from sample validation", () => {
        expect(
            computeEntityPreviewPassed({
                import_type: "Customer",
                validation_errors: [],
                sample_rows: [{ id: 1 }],
                sorted_preview: false,
            })
        ).toBe(true);
        expect(
            computeEntityPreviewPassed({
                import_type: "Customer",
                validation_errors: ["missing"],
                sample_rows: [{ id: 1 }],
                sorted_preview: false,
            })
        ).toBe(false);
        expect(
            computeEntityPreviewPassed({
                import_type: "Invoice",
                validation_errors: [],
                sample_rows: [{ id: 1 }],
                sorted_preview: false,
            })
        ).toBe(false);
    });
});

describe("connectorSyncCancelRegistry", () => {
    beforeEach(() => {
        resetConnectorSyncCancelRegistryForTests();
    });

    it("tracks cancel requests per execution id", () => {
        expect(isConnectorSyncCancelRequested("a")).toBe(false);
        requestConnectorSyncCancel("a");
        expect(isConnectorSyncCancelRequested("a")).toBe(true);
        expect(isConnectorSyncCancelRequested("b")).toBe(false);
    });

    it("clears a cancel request", () => {
        requestConnectorSyncCancel("a");
        clearConnectorSyncCancel("a");
        expect(isConnectorSyncCancelRequested("a")).toBe(false);
    });
});
