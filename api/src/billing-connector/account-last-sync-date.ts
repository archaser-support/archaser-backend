import type { ImportType } from "@prisma/client";

import { isPriorityEntityImportType } from "@archaser/billing-connector";

/**
 * Account-wide data-freshness marker, derived from per-entity connector sync
 * state instead of a stored column.
 *
 * Oldest wins so a single stuck entity cannot hide behind a fresher one.
 * Entities that have never synced are skipped rather than forcing null, so a
 * connector still working through its first backfill reports the progress it
 * has made.
 */
export function pickAccountLastSyncDate(
    enabledEntities: ImportType[],
    states: Array<{ entity_type: ImportType; last_successful_run_at: Date | null }>
): Date | null {
    const enabled = new Set(enabledEntities);
    const successTimes = states
        .filter((state) => enabled.has(state.entity_type))
        .map((state) => state.last_successful_run_at)
        .filter((value): value is Date => value != null);

    if (successTimes.length === 0) {
        return null;
    }

    return successTimes.reduce((oldest, current) =>
        current.getTime() < oldest.getTime() ? current : oldest
    );
}

const ENTITY_KEYS: ImportType[] = ["Customer", "Contact", "Invoice", "Payment"];

export function parseEnabledEntitiesForSyncDate(raw: unknown): ImportType[] {
    if (!Array.isArray(raw)) {
        return [...ENTITY_KEYS];
    }
    return raw.filter((value): value is ImportType => {
        return (
            typeof value === "string" &&
            isPriorityEntityImportType(value as ImportType)
        );
    });
}
