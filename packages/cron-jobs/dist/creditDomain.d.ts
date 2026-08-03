import type { PrismaClient } from "@prisma/client";
export declare function bindCreditDomain(prisma: PrismaClient): void;
export declare function requireCreditDomainModule<T>(relativeJsPath: string): T;
