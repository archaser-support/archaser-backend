import { ReportExecutionService } from "../src/reports/report-execution.service";

describe("ReportExecutionService audit users + sort guards", () => {
    // Access private helpers for regression coverage of Nest report parity gaps.
    const service = new ReportExecutionService(
        {} as never,
        {} as never
    ) as any;

    it("falls back InsurancePolicy.policy_number sort to id (no invalid Prisma orderBy)", () => {
        const parsed = service.parseSortField(
            "InsurancePolicy.policy_number",
            "Customer"
        );
        expect(parsed).not.toBeNull();
        expect(parsed("asc")).toEqual({ id: "asc" });
        expect(parsed("desc")).toEqual({ id: "desc" });
    });

    it("selects User relation for modified_by / created_by on Customer", () => {
        const select: Record<string, unknown> = { id: true };
        expect(
            service.applyAuditUserSelect("Customer", "modified_by", select)
        ).toBe(true);
        expect(select.modified_by).toBe(true);
        expect(select.User_Customer_modified_byToUser).toEqual({
            select: { id: true, name: true, email: true },
        });

        expect(
            service.applyAuditUserSelect("Customer", "created_by", select)
        ).toBe(true);
        expect(select.User_Customer_created_byToUser).toBeDefined();
    });

    it("extracts username from audit user relation instead of raw UUID", () => {
        const row = {
            modified_by: "3bfd1335-7389-4289-a307-6ff5e925eb4b",
            User_Customer_modified_byToUser: {
                name: "Jane Collector",
                email: "jane@archaser.test",
            },
        };
        expect(
            service.extractAuditUserName(row, "Customer", "modified_by")
        ).toBe("Jane Collector");
    });

    it("falls back to email then id when name is missing", () => {
        expect(
            service.extractAuditUserName(
                {
                    modified_by: "user-uuid",
                    User_Customer_modified_byToUser: {
                        name: null,
                        email: "agent@archaser.test",
                    },
                },
                "Customer",
                "modified_by"
            )
        ).toBe("agent@archaser.test");

        expect(
            service.extractAuditUserName(
                { modified_by: "user-uuid" },
                "Customer",
                "modified_by"
            )
        ).toBe("user-uuid");
    });

    it("buildSelect includes audit user relation for modified_by field", () => {
        const select = service.buildSelect("Customer", [
            { table: "Customer", field: "modified_by" },
        ]);
        expect(select.modified_by).toBe(true);
        expect(select.User_Customer_modified_byToUser).toBeDefined();
        expect(select).not.toHaveProperty("InsurancePolicy");
    });

    it("buildSelect includes Country.name and State.name for All Customers fields", () => {
        const select = service.buildSelect("Customer", [
            { table: "Customer", field: "Country.name" },
            { table: "Customer", field: "State.name" },
        ]);
        expect(select.Country).toEqual({
            select: { id: true, name: true },
        });
        expect(select.State).toEqual({
            select: { id: true, name: true },
        });
    });

    it("extracts Country.name / State.name from selected relations", () => {
        const row = {
            id: 1,
            Country: { id: 3, name: "Israel" },
            State: { id: 7, name: "Tel Aviv" },
        };
        expect(
            service.extractFieldValue(
                row,
                "Customer",
                { table: "Customer", field: "Country.name" },
                { Country: "Country", State: "State" }
            )
        ).toBe("Israel");
        expect(
            service.extractFieldValue(
                row,
                "Customer",
                { table: "Customer", field: "State.name" },
                { Country: "Country", State: "State" }
            )
        ).toBe("Tel Aviv");
    });
});
