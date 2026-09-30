import {
    AGGREGATED_DATA_TERMINAL_CLAIM_STATUSES,
    buildClaimCountsByCustomer,
    buildCollectionAggregatedData,
    buildCreditAggregatedBlock,
    customerDisplayNameFromParts,
    isOpenAggregatedClaimStatus,
} from "../src/customers/domain/customerAggregatedData";

describe("customerAggregatedData response shape", () => {
    it("builds collection aggregatedData + childCustomers without silent empty mismatch", () => {
        const result = buildCollectionAggregatedData(10, [
            {
                id: 11,
                customer_number: "C-11",
                type: "Company",
                name: "Child A",
                total_due_amount: 100,
                total_overdue_amount: 50,
                no_of_due_invoices: 2,
                number_of_overdue_invoices: 1,
                customer_due_amount1: 100,
                customer_due_currency1: "USD",
                customer_due_amount2: null,
                customer_due_currency2: null,
                customer_overdue_amount1: 50,
                customer_overdue_currency1: "USD",
                customer_overdue_amount2: null,
                customer_overdue_currency2: null,
            },
            {
                id: 12,
                customer_number: "C-12",
                type: "Person",
                name: "Child B",
                total_due_amount: 20,
                total_overdue_amount: 0,
                no_of_due_invoices: 1,
                number_of_overdue_invoices: 0,
                customer_due_amount1: 20,
                customer_due_currency1: "EUR",
                customer_due_amount2: null,
                customer_due_currency2: null,
                customer_overdue_amount1: null,
                customer_overdue_currency1: null,
                customer_overdue_amount2: null,
                customer_overdue_currency2: null,
            },
        ]);

        expect(result.aggregatedData).toMatchObject({
            customer_id: 10,
            child_customers_count: 2,
            total_outstanding_amount: 170,
            no_of_overdue_invoices: 1,
            no_of_due_invoices: 3,
            total_invoices_count: 4,
        });
        expect(result.childCustomers).toHaveLength(2);
        expect(result.childCustomers[0]).toMatchObject({
            id: 11,
            name: "Child A",
            outstanding_amount: 150,
            due_amount: 100,
            overdue_invoices: 1,
            due_invoices: 2,
        });
        expect(result.totalDueAmount).toBe(120);
        expect(result.customerTotalDueCurrency1).toBe("USD");
        expect(result.customerTotalDueAmount1).toBe(100);
        expect(result.customerTotalDueCurrency2).toBe("EUR");
        expect(result.customerTotalDueAmount2).toBe(20);
    });

    it("treats Paid/Rejected/Canceled as terminal for open claim counts", () => {
        expect(AGGREGATED_DATA_TERMINAL_CLAIM_STATUSES).toEqual([
            "Paid",
            "Rejected",
            "Canceled",
        ]);
        expect(isOpenAggregatedClaimStatus("Draft")).toBe(true);
        expect(isOpenAggregatedClaimStatus("Paid")).toBe(false);
        expect(isOpenAggregatedClaimStatus("Rejected")).toBe(false);
        expect(isOpenAggregatedClaimStatus("Canceled")).toBe(false);

        const counts = buildClaimCountsByCustomer([
            { customer_id: 1, status: "Draft" },
            { customer_id: 1, status: "Paid" },
            { customer_id: 2, status: "Submitted" },
            { customer_id: 2, status: "Canceled" },
        ]);
        expect(counts.get(1)).toEqual({
            customer_id: 1,
            open_claims_count: 1,
            total_claims_count: 2,
        });
        expect(counts.get(2)).toEqual({
            customer_id: 2,
            open_claims_count: 1,
            total_claims_count: 2,
        });
    });

    it("builds credit KPIs + per-member and group claim counts", () => {
        const counts = buildClaimCountsByCustomer([
            { customer_id: 1, status: "Draft" },
            { customer_id: 2, status: "Paid" },
            { customer_id: 2, status: "Approved" },
        ]);
        const credit = buildCreditAggregatedBlock(
            {
                root_customer_id: 1,
                approved_limit: 1000,
                approved_limit_currency: "USD",
                effective_limit: 1200,
                capacity_gap_amount: 100,
                uninsured_amount: 25,
                capacity_gap_amount1: 100,
                capacity_gap_currency1: "USD",
                capacity_gap_amount2: null,
                capacity_gap_currency2: null,
                uninsured_amount1: 25,
                uninsured_currency1: "USD",
                uninsured_amount2: null,
                uninsured_currency2: null,
            },
            [
                {
                    id: 1,
                    customer_number: "ROOT",
                    type: "Company",
                    name: "Root Co",
                    parent_customer_id: null,
                },
                {
                    id: 2,
                    customer_number: "CHILD",
                    type: "Company",
                    name: "Child Co",
                    parent_customer_id: 1,
                },
            ],
            counts
        );

        expect(credit.root_customer_id).toBe(1);
        expect(credit.approved_limit).toBe(1000);
        expect(credit.effective_limit).toBe(1200);
        expect(credit.capacity_gap_amount).toBe(100);
        expect(credit.uninsured_amount).toBe(25);
        expect(credit.open_claims_count).toBe(2);
        expect(credit.total_claims_count).toBe(3);
        expect(credit.members).toEqual([
            {
                id: 1,
                customer_number: "ROOT",
                name: "Root Co",
                type: "Company",
                parent_customer_id: null,
                open_claims_count: 1,
                total_claims_count: 1,
            },
            {
                id: 2,
                customer_number: "CHILD",
                name: "Child Co",
                type: "Company",
                parent_customer_id: 1,
                open_claims_count: 1,
                total_claims_count: 2,
            },
        ]);
    });

    it("resolves display names from company or person parts", () => {
        expect(
            customerDisplayNameFromParts({
                companyName: "Acme",
                personFirstName: "A",
                personLastName: "B",
            })
        ).toBe("Acme");
        expect(
            customerDisplayNameFromParts({
                personFullName: "Jane Doe",
                customerNumber: "X",
            })
        ).toBe("Jane Doe");
        expect(
            customerDisplayNameFromParts({
                personFirstName: "Jane",
                personLastName: "Doe",
            })
        ).toBe("Jane Doe");
        expect(
            customerDisplayNameFromParts({ customerNumber: "C-9" })
        ).toBe("C-9");
    });
});
