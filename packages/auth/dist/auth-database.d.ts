import { PrismaClient } from "@prisma/client";
/** Injection token for the service Prisma / DatabaseService instance. */
export declare const AUTH_DATABASE: unique symbol;
export type AuthDatabase = PrismaClient;
