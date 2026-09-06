import type { PrismaClient } from "@prisma/client";

import {
    beginCronFrozenAccountGuard,
    type CronFrozenAccountGuard,
} from "../src/accountFreeze/cronFrozenAccountGuard";
import { executeNamedCronJob } from "../src/handlers";
import { processDueNotifications } from "../src/processDueNotifications";

jest.mock("../src/currencyRateService", () => ({
    fetchAndStoreCurrencyRates: jest.fn().mockResolvedValue({ ratesStored: 3 }),
}));

const ACCOUNT_FROZEN = 101;
const ACCOUNT_CONTROL = 202;

async function buildFreezeGuard(
    prisma: PrismaClient,
    frozenImportAccountIds: number[]
): Promise<CronFrozenAccountGuard> {
    return beginCronFrozenAccountGuard(prisma, "Process Due Notifications", {
        listRunningSyncAccountIds: async () => [],
        frozenImportAccountIds,
    });
}

describe("collection crons frozen-account skip", () => {
    const originalMongoUri = process.env.MONGODB_URI;

    beforeEach(() => {
        delete process.env.MONGODB_URI;
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (originalMongoUri === undefined) {
            delete process.env.MONGODB_URI;
        } else {
            process.env.MONGODB_URI = originalMongoUri;
        }
    });

    it("processDueNotifications skips due steps for frozen accounts", async () => {
        const dueSteps = [
            {
                id: 1,
                account_id: ACCOUNT_FROZEN,
                days_before_due: 3,
                step_type: "due",
                ActivitiesTemplate: { ActivityTemplateLanguage: [] },
            },
            {
                id: 2,
                account_id: ACCOUNT_CONTROL,
                days_before_due: 3,
                step_type: "due",
                ActivitiesTemplate: { ActivityTemplateLanguage: [] },
            },
        ];
        const invoiceFindMany = jest.fn().mockResolvedValue([]);

        const prisma = {
            $queryRaw: jest.fn(async () => []),
            activitiesSequence: {
                findMany: jest.fn().mockResolvedValue(dueSteps),
            },
            sequenceContainer: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 10, account_id: ACCOUNT_CONTROL },
                ]),
            },
            invoice: { findMany: invoiceFindMany },
        } as unknown as PrismaClient;

        const freeze = await buildFreezeGuard(prisma, [ACCOUNT_FROZEN]);
        const result = await processDueNotifications(prisma, { freeze });

        expect(result.success).toBe(true);
        expect(invoiceFindMany).toHaveBeenCalledTimes(1);
        expect(invoiceFindMany.mock.calls[0][0].where.Customer.account_id).toBe(
            ACCOUNT_CONTROL
        );
    });

    it("Fetch Currency Rates runs without frozen-account guard", async () => {
        const { fetchAndStoreCurrencyRates } = jest.requireMock(
            "../src/currencyRateService"
        );
        const prisma = {
            $queryRaw: jest.fn(async () => []),
        } as unknown as PrismaClient;

        const result = await executeNamedCronJob(
            prisma,
            "Fetch Currency Rates"
        );

        expect(result.success).toBe(true);
        expect(fetchAndStoreCurrencyRates).toHaveBeenCalledWith(prisma);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
});
