import type { PrismaClient } from "@prisma/client";
export declare function requireCustomersDomainModule<T>(relativeJsPath: string): T;
export declare function recalculateCustomerAmountsViaApi(customerIds: number[], prisma: PrismaClient): Promise<void>;
