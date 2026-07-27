/**
 * Runtime Prisma bind for Nest-ported credit-insurance domain modules.
 * Domain files import `prisma` from here; CreditInsuranceModule binds DatabaseService on init.
 */
import type { PrismaClient } from "@prisma/client";

export let prisma: PrismaClient;

export function bindCreditInsurancePrisma(client: PrismaClient): void {
    prisma = client;
}

export type DbClient = PrismaClient;
