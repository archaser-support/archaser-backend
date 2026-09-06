import {
    PRIORITY_ENTITY_ENDPOINTS,
    buildDefaultMappingRules,
    mapErpRecord,
} from "../src/index";

describe("Priority customer field enrichment", () => {
    it("requests expanded CUSTOMERS discovery fields", () => {
        const { discoveryFields } = PRIORITY_ENTITY_ENDPOINTS.Customer;

        expect(discoveryFields).toEqual(
            expect.arrayContaining([
                "COUNTRYCODE",
                "STATECODE",
                "STATEA",
                "ADDRESS2",
                "MCUSTNAME",
            ])
        );
        expect(discoveryFields).not.toEqual(
            expect.arrayContaining(["IDG_COMPANYNAME"])
        );
    });

    it("maps expanded Archaser customer fields to Priority ERP fields", () => {
        const rules = buildDefaultMappingRules("Customer");
        const byArchaser = Object.fromEntries(
            rules.map((rule) => [rule.archaserField, rule.erpField])
        );

        expect(byArchaser).toMatchObject({
            customer_number: "CUSTNAME",
            name: "CUSTDES",
            crn: "WTAXNUM",
            owner_email: "EMAIL",
            address_line1: "ADDRESS",
            address_line2: "ADDRESS2",
            city: "STATEA",
            state_iso2: "STATECODE",
            postal_code: "ZIP",
            country_iso2: "COUNTRYCODE",
            parent_customer_number: "MCUSTNAME",
        });
        expect(byArchaser.business_unit).toBeUndefined();
    });

    it("maps a Priority customer record through the expanded defaults", () => {
        const rules = buildDefaultMappingRules("Customer");
        const mapped = mapErpRecord(
            {
                CUSTNAME: "T000001",
                CUSTDES: "Acme Trading Ltd",
                WTAXNUM: "US-514123456",
                EMAIL: "billing@acme.example",
                ADDRESS: "100 Market St",
                ADDRESS2: "Suite 400",
                STATEA: "San Francisco",
                STATECODE: "CA",
                ZIP: "94105",
                COUNTRYCODE: "US",
                MCUSTNAME: "P000001",
            },
            rules
        );

        expect(mapped).toMatchObject({
            customer_number: "T000001",
            name: "Acme Trading Ltd",
            crn: "US-514123456",
            owner_email: "billing@acme.example",
            address_line1: "100 Market St",
            address_line2: "Suite 400",
            city: "San Francisco",
            state_iso2: "CA",
            postal_code: "94105",
            country_iso2: "US",
            parent_customer_number: "P000001",
        });
        expect(mapped.business_unit).toBeUndefined();
    });
});
