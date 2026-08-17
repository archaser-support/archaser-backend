import { ImportPolicyService } from "../src/import/import-policy.service";

const today = new Date();

function createDb() {
    return {
        customer: {
            findFirst: jest.fn().mockResolvedValue({
                id: 7,
                country_id: 3,
                customer_number: "CUST-1",
                business_unit_id: null,
            }),
        },
        businessUnit: { findFirst: jest.fn() },
        insurancePolicy: {
            findFirst: jest.fn().mockResolvedValue({
                id: 11,
                max_payment_term: 30,
                max_allowed_mep: 45,
                reporting_days: 10,
                mep_cutoff_day_of_month: null,
                mep_substitute_day_of_month: null,
                reporting_cutoff_day_of_month: null,
                reporting_substitute_day_of_month: null,
                payment_term_cutoff_day_of_month: null,
                payment_term_substitute_day_of_month: null,
                cost_percent: null,
                registration_fee_percent: null,
                start_date: today,
                end_date: today,
            }),
        },
        namedPolicy: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
                customer_number: "CUST-1",
                max_payment_term: null,
                customer_mep: null,
                reporting_days: null,
                customer_max_limit: null,
                limit_expiration_date: null,
            }),
        },
        insurancePolicyCountry: { findFirst: jest.fn().mockResolvedValue(null) },
        customerPolicy: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 1 }),
            update: jest.fn().mockResolvedValue({ id: 1 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: jest.fn(async (callback) =>
            callback({
                customerPolicy: {
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                    create: jest.fn().mockResolvedValue({ id: 2 }),
                },
            })
        ),
    };
}

const context = {
    accountId: 42,
    userId: "user-1",
    businessUnitId: null,
    role: "Admin",
};

const row = {
    policy_number: "POL-1",
    customer_number: "CUST-1",
    limit_type: "Named",
};

describe("ImportPolicyService", () => {
    it("auto-creates a NamedPolicy master when no master matches", async () => {
        const db = createDb();
        const syncCustomer = jest.fn().mockResolvedValue(undefined);
        const service = new ImportPolicyService(
            db as never,
            {
                isAdminAccount: jest.fn().mockReturnValue(true),
                getBusinessUnitHierarchy: jest.fn(),
            } as never
        );
        Object.assign(service, { syncCustomer });

        await expect(
            service.importPolicyRow({ ...row, approved_limit: "9000" }, context)
        ).resolves.toEqual({
            success: true,
            action: "create",
            customerId: 7,
        });
        expect(db.namedPolicy.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                insurance_policy_id: 11,
                customer_number: "CUST-1",
                customer_max_limit: "9000",
                created_by: "user-1",
            }),
        });
    });

    it("clears a prior exclusion reason when the import explicitly provides a blank reason", async () => {
        const db = createDb();
        db.customerPolicy.findFirst.mockResolvedValue({
            id: 3,
            insurance_policy_id: 11,
        });
        const service = new ImportPolicyService(
            db as never,
            {
                isAdminAccount: jest.fn().mockReturnValue(true),
                getBusinessUnitHierarchy: jest.fn(),
            } as never
        );
        Object.assign(service, {
            syncCustomer: jest.fn().mockResolvedValue(undefined),
        });

        await expect(
            service.importPolicyRow(
                {
                    ...row,
                    limit_type: "DCL",
                    policy_exclusion_reason: "  ",
                },
                context
            )
        ).resolves.toMatchObject({ success: true, action: "patch" });
        expect(db.customerPolicy.update).toHaveBeenCalledWith({
            where: { id: 3 },
            data: expect.objectContaining({
                policy_exclusion_reason: null,
                excluded_from_policy: false,
            }),
        });
    });

    it("returns validation errors before writing a policy assignment", async () => {
        const db = createDb();
        const service = new ImportPolicyService(
            db as never,
            {
                isAdminAccount: jest.fn().mockReturnValue(true),
                getBusinessUnitHierarchy: jest.fn(),
            } as never
        );
        Object.assign(service, { syncCustomer: jest.fn() });

        await expect(
            service.importPolicyRow(
                {
                    ...row,
                    limit_type: "invalid",
                },
                context
            )
        ).resolves.toEqual({
            success: false,
            errorCode: "invalid_limit_type",
            message: "import.validation.invalidLimitType",
        });
        expect(db.customerPolicy.create).not.toHaveBeenCalled();
        expect(db.customerPolicy.update).not.toHaveBeenCalled();
    });
});
