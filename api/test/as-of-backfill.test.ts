import { ForbiddenException } from "@nestjs/common";

jest.mock("../src/credit-insurance/domain/asOfRewriteQueue", () => ({
    enqueueAsOfRewrite: jest.fn().mockResolvedValue(undefined),
}));

import { AsOfBackfillController } from "../src/credit-insurance/as-of-backfill.controller";
import { InsuranceEntitiesService } from "../src/credit-insurance/insurance-entities.service";
import { enqueueAsOfRewrite } from "../src/credit-insurance/domain/asOfRewriteQueue";

describe("as-of backfill controls", () => {
    it("rejects a non-super-admin before reading backfill status", async () => {
        const controller = new AsOfBackfillController({} as never);

        await expect(
            controller.getStatus(
                { sub: "user-1", username: "user", account_id: 42 },
                123
            )
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("enqueues a rewrite after a policy write", async () => {
        const db = {
            insurancePolicy: {
                create: jest.fn().mockResolvedValue({
                    id: 7,
                    start_date: new Date("2025-01-01T00:00:00.000Z"),
                }),
            },
        };
        const accessScope = {
            resolveUserInfo: jest.fn().mockResolvedValue({
                accountId: 123,
                userId: "admin-1",
            }),
            getEffectiveAccountId: jest.fn().mockReturnValue(123),
        };
        const service = new InsuranceEntitiesService(
            db as never,
            accessScope as never
        );

        await service.create(
            "insurance-policies",
            { sub: "admin-1", username: "admin", account_id: 123 },
            {
                policy_number: "POL-1",
                start_date: new Date("2025-01-01T00:00:00.000Z"),
                end_date: new Date("2025-12-31T00:00:00.000Z"),
            }
        );

        expect(enqueueAsOfRewrite).toHaveBeenCalledWith(
            expect.objectContaining({
                accountId: 123,
                fromDate: new Date("2025-01-01T00:00:00.000Z"),
            })
        );
    });
});
