import { Prisma } from "@prisma/client";

import type { DatabaseService } from "../database/database.service";

/** Scalar Customer columns the Policies/General tab PUT may send. */
const CUSTOMER_SCALAR_KEYS = [
    "customer_number",
    "crn",
    "phone",
    "email",
    "address_line1",
    "address_line2",
    "city",
    "postal_code",
    "collection_status",
    "language",
    "first_activity_delay_days",
    "category_for_new_collection",
    "generic_text1",
    "generic_text2",
    "generic_number1",
    "generic_number2",
    "generic_date1",
    "generic_date2",
] as const;

/** FK scalars accepted on CustomerUncheckedUpdateInput. */
const CUSTOMER_FK_KEYS = [
    "country_id",
    "state_id",
    "owner_id",
    "sequence_container_id",
    "business_unit_id",
    "parent_customer_id",
] as const;

function parseOptionalIntFk(value: unknown): number | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseOptionalStringFk(value: unknown): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    return String(value);
}

function parseOptionalDate(value: unknown): Date | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Map the frontend customer PUT body to Prisma unchecked update input.
 * Virtual keys (`customer_name`, `customer_type`, policy fields) are excluded.
 */
export function buildCustomerUncheckedUpdateData(
    body: Record<string, unknown>
): Prisma.CustomerUncheckedUpdateInput {
    const data: Prisma.CustomerUncheckedUpdateInput = {};

    for (const key of CUSTOMER_SCALAR_KEYS) {
        if (!(key in body)) {
            continue;
        }
        if (key === "generic_date1" || key === "generic_date2") {
            data[key] = parseOptionalDate(body[key]);
            continue;
        }
        (data as Record<string, unknown>)[key] = body[key];
    }

    for (const key of CUSTOMER_FK_KEYS) {
        if (!(key in body)) {
            continue;
        }
        if (key === "owner_id") {
            data.owner_id = parseOptionalStringFk(body.owner_id);
            continue;
        }
        (data as Record<string, unknown>)[key] = parseOptionalIntFk(body[key]);
    }

    return data;
}

/** Persist display name on linked Person or Company row. */
export async function applyCustomerNameUpdate(
    db: DatabaseService,
    customerId: number,
    customerName: unknown,
    userId: string
): Promise<void> {
    if (customerName === undefined) {
        return;
    }
    const trimmed = String(customerName ?? "").trim();
    if (!trimmed) {
        return;
    }

    const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { type: true, person_id: true, company_id: true },
    });
    if (!customer) {
        return;
    }

    if (customer.type === "Company" && customer.company_id != null) {
        await db.company.update({
            where: { id: customer.company_id },
            data: { name: trimmed, modified_by: userId },
        });
        return;
    }

    if (customer.type === "Person" && customer.person_id != null) {
        const parts = trimmed.split(/\s+/).filter(Boolean);
        const first_name = parts[0] ?? trimmed;
        const last_name =
            parts.length > 1 ? parts.slice(1).join(" ") : null;
        await db.person.update({
            where: { id: customer.person_id },
            data: {
                first_name,
                last_name,
                full_name: trimmed,
                modified_by: userId,
            },
        });
    }
}
