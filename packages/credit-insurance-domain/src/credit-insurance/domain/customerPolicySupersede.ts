import type { Prisma } from "@prisma/client";

import { toUtcDateOnly } from "./shared/insurancePolicyLifecycle";

/**
 * Fields to mark a live CustomerPolicy as superseded by a newer version.
 * `policy_change_end_date` is the first UTC day the old version is no longer
 * the live attachment (same meaning as dated unassign) — equal to the next
 * version's `policy_change_start_date`.
 */
export function customerPolicySupersedeUpdateData(args: {
    nextVersionStartDate: Date;
    modifiedBy?: string | null;
}): {
    is_active: false;
    status: "inactive";
    policy_change_end_date: Date;
    modified_by?: string;
} {
    const data = {
        is_active: false as const,
        status: "inactive" as const,
        policy_change_end_date: toUtcDateOnly(args.nextVersionStartDate),
    };
    if (args.modifiedBy != null && args.modifiedBy !== "") {
        return { ...data, modified_by: args.modifiedBy };
    }
    return data;
}

/**
 * Close every non-pending CustomerPolicy version of a customer at `fromDate`
 * so a version saved now wins from `fromDate` onward, even when it is
 * backdated before versions saved earlier:
 * - start < fromDate → end = fromDate (unless it already ended earlier)
 * - start ≥ fromDate → end = start (zero-length; never effective on as-of)
 *
 * Call before creating the new version. Returns the number of rows closed.
 */
export async function closeCustomerPolicyVersionsFromDate(args: {
    db: Pick<Prisma.TransactionClient, "$executeRaw">;
    customerId: number;
    fromDate: Date;
    modifiedBy?: string | null;
}): Promise<number> {
    const fromDay = toUtcDateOnly(args.fromDate);
    const modifiedBy =
        args.modifiedBy != null && args.modifiedBy !== "" ? args.modifiedBy : null;
    return args.db.$executeRaw`
        UPDATE "CustomerPolicy"
        SET policy_change_end_date = GREATEST(policy_change_start_date, ${fromDay}::date),
            is_active = false,
            status = 'inactive'::customer_policy_status,
            modified_by = COALESCE(${modifiedBy}::varchar, modified_by),
            modified_at = NOW()
        WHERE customer_id = ${args.customerId}
          AND status <> 'pending'::customer_policy_status
          AND (
            policy_change_end_date IS NULL
            OR policy_change_end_date > GREATEST(policy_change_start_date, ${fromDay}::date)
          )
    `;
}
