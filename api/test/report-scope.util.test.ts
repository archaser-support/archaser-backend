import {
    buildAccountScopeWhere,
    nestBusinessUnitScopeWhere,
    nestOwnerScopeWhere,
} from "../src/reports/report-scope.util";

describe("buildAccountScopeWhere", () => {
    it("scopes Contact through Company.Customer (no account_id on Contact)", () => {
        expect(buildAccountScopeWhere("Contact", 10117)).toEqual({
            Company: {
                Customer: {
                    some: { account_id: 10117 },
                },
            },
        });
    });

    it("scopes Dispute through Customer.account_id", () => {
        expect(buildAccountScopeWhere("Dispute", 42)).toEqual({
            Customer: { account_id: 42 },
        });
    });

    it("scopes Customer with direct account_id", () => {
        expect(buildAccountScopeWhere("Customer", 42)).toEqual({
            account_id: 42,
        });
    });
    it("scopes CustomerBanks with direct account_id", () => {
        expect(buildAccountScopeWhere("CustomerBanks", 42)).toEqual({
            account_id: 42,
        });
    });
});

describe("nestOwnerScopeWhere", () => {
    it("nests Contact owner through Company.Customer", () => {
        expect(
            nestOwnerScopeWhere("Contact", { owner_id: "u1" })
        ).toEqual({
            Company: {
                Customer: {
                    some: { owner_id: "u1" },
                },
            },
        });
    });

    it("nests CustomerBanks owner through Customer", () => {
        expect(
            nestOwnerScopeWhere("CustomerBanks", { owner_id: "u1" })
        ).toEqual({
            Customer: { owner_id: "u1" },
        });
    });
});

describe("nestBusinessUnitScopeWhere", () => {
    it("nests CustomerBanks BU through Customer", () => {
        expect(
            nestBusinessUnitScopeWhere("CustomerBanks", {
                business_unit_id: { in: [1, 2] },
            })
        ).toEqual({
            Customer: { business_unit_id: { in: [1, 2] } },
        });
    });

    it("nests Contact BU through Company.Customer", () => {
        expect(
            nestBusinessUnitScopeWhere("Contact", {
                business_unit_id: { in: [1, 2] },
            })
        ).toEqual({
            Company: {
                Customer: {
                    some: { business_unit_id: { in: [1, 2] } },
                },
            },
        });
    });
});
