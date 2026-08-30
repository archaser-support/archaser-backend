/**
 * Runtime Prisma bind for the shared credit-insurance domain modules.
 * Domain files import `prisma` from here; each service binds its own client on startup.
 */
import type { PrismaClient } from "@prisma/client";

/**
 * Thrown when a domain module touches the database before a service has called
 * `bindCreditInsurancePrisma`. Without this the first query fails as a property
 * access on `undefined`, far from the missing setup call.
 */
export class CreditInsurancePrismaNotBoundError extends Error {
    constructor(accessedProperty: string) {
        super(
            `Credit-insurance domain database client is not bound (while reading "${accessedProperty}"). ` +
                "Call bindCreditInsurancePrisma(client) once during service startup, " +
                "before invoking any credit-insurance domain function."
        );
        this.name = "CreditInsurancePrismaNotBoundError";
    }
}

let boundClient: PrismaClient | undefined;

/** Marks the forwarding proxy so it can never be bound as its own target. */
const PROXY_MARKER = Symbol.for("archaser.creditInsurancePrismaProxy");

export function bindCreditInsurancePrisma(client: PrismaClient): void {
    // Callers that receive the exported proxy as a `prisma` argument and re-bind
    // it would make every property read forward to itself forever.
    if (
        !client ||
        (client as unknown as Record<symbol, unknown>)[PROXY_MARKER] === true
    ) {
        return;
    }
    boundClient = client;
}

/**
 * Stands in for the bound client so the existing 143 `prisma.model.query()` call
 * sites keep working unchanged. Every property read resolves against the client
 * bound at startup, or raises `CreditInsurancePrismaNotBoundError`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
    get(_target, property) {
        if (property === PROXY_MARKER) {
            return true;
        }
        if (!boundClient) {
            throw new CreditInsurancePrismaNotBoundError(String(property));
        }
        const value = (boundClient as unknown as Record<string | symbol, unknown>)[
            property
        ];
        return typeof value === "function" ? value.bind(boundClient) : value;
    },
});

export type DbClient = PrismaClient;
