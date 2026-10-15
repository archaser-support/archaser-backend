import { account10149Extension } from "../account_10149";
import type {
    BillingAccountExtension,
    ExtensionMappedBatch,
    ExtensionTransformContext,
} from "../types";
import { anonymizeNewCustomerNames } from "./demoCustomerNames";

/** Account 10151 — Priority IDG (10149) plus demo customer name anonymization. */
export const ACCOUNT_10151_EXTENSION_KEY = "account_10151";
export const ACCOUNT_10151_ID = 10151;

export const account10151Extension: BillingAccountExtension = {
    ...account10149Extension,
    key: ACCOUNT_10151_EXTENSION_KEY,
    label: "Account 10151",
    async transform(
        ctx: ExtensionTransformContext
    ): Promise<ExtensionMappedBatch> {
        const batch = await account10149Extension.transform(ctx);
        const customers = batch.Customer;
        if (!customers?.length) {
            return batch;
        }
        const renamed = await anonymizeNewCustomerNames(customers, {
            accountId: ctx.accountId,
            prisma: ctx.prisma,
        });
        return { ...batch, Customer: renamed };
    },
};

export {
    DEMO_CUSTOMER_NAME_PREFIX,
    anonymizeNewCustomerNames,
    formatDemoCustomerName,
    nextDemoCustomerCounter,
    parseDemoNameCounter,
} from "./demoCustomerNames";
