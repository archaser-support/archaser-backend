/**
 * Runtime Prisma bind for Nest-ported credit-insurance domain modules.
 * Domain files import `prisma` from here; CreditInsuranceModule binds DatabaseService on init.
 */
import type { PrismaClient } from "@prisma/client";
export declare let prisma: PrismaClient;
export declare function bindCreditInsurancePrisma(client: PrismaClient): void;
export type DbClient = PrismaClient;
