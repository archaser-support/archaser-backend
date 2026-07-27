import {
    attachLinkingIds,
    getFieldLinkMetadata,
} from "../src/reports/report-link.util";

describe("getFieldLinkMetadata", () => {
    it("links Customer.name when Customer is primary", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Customer", field: "name" },
                { id: 15, name: "Acme" },
                "Customer",
                "Customer.name"
            )
        ).toEqual({ type: "customer", id: 15 });
    });

    it("links Customer.name on Invoice via customer_id", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Customer", field: "name" },
                {
                    id: 100,
                    customer_id: 15,
                    Customer: { id: 15, Company: { name: "Acme" } },
                },
                "Invoice",
                "Customer.name"
            )
        ).toEqual({ type: "customer", id: 15 });
    });

    it("links Customer.name on Invoice via Customer.id when FK missing", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Customer", field: "name" },
                {
                    id: 100,
                    Customer: { id: 22, Company: { name: "Beta" } },
                },
                "Invoice",
                "Customer.name"
            )
        ).toEqual({ type: "customer", id: 22 });
    });

    it("does not link invoice_number", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Invoice", field: "invoice_number" },
                { id: 42, invoice_number: "INV-42", customer_id: 15 },
                "Invoice",
                "Invoice.invoice_number"
            )
        ).toBeNull();
    });

    it("links parent_customer_name with aggregated_data tab", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Customer", field: "parent_customer_name" },
                { id: 15, parent_customer_id: 7 },
                "Customer",
                "Customer.parent_customer_name"
            )
        ).toEqual({
            type: "customer",
            id: 7,
            tab: "aggregated_data",
        });
    });

    it("links Contact.first_name to customer general tab", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Contact", field: "first_name" },
                { id: 3, customer_id: 15, first_name: "Jane" },
                "Contact",
                "Contact.first_name"
            )
        ).toEqual({ type: "customer", id: 15, tab: "general" });
    });

    it("links Dispute.dispute_number to customer with openDispute tab", () => {
        expect(
            getFieldLinkMetadata(
                { table: "Dispute", field: "dispute_number" },
                { id: 99, customer_id: 15 },
                "Dispute",
                "Dispute.dispute_number"
            )
        ).toEqual({
            type: "dispute",
            id: 15,
            tab: "outstanding-activities-tab&openDispute=99",
        });
    });
});

describe("attachLinkingIds", () => {
    it("sets customer_id from Customer primary id", () => {
        const out: Record<string, unknown> = { id: 15 };
        attachLinkingIds(out, { id: 15 }, "Customer", ["Customer"]);
        expect(out.customer_id).toBe(15);
    });

    it("sets customer_id from nested Customer on Invoice", () => {
        const out: Record<string, unknown> = { id: 100 };
        attachLinkingIds(
            out,
            { id: 100, Customer: { id: 22 } },
            "Invoice",
            ["Invoice", "Customer"]
        );
        expect(out.customer_id).toBe(22);
    });
});
