import { PrismaClient } from "@prisma/client";

/** Injection token for the service Prisma / DatabaseService instance. */
export const AUTH_DATABASE = Symbol("AUTH_DATABASE");

export type AuthDatabase = PrismaClient;
