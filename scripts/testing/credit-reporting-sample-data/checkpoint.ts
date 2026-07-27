import * as fs from "fs";
import * as path from "path";

import { CHECKPOINT_DIR, CHECKPOINT_FILENAME } from "./constants";
import type { CheckpointData, HistoryWindow } from "./types";

function getCheckpointPath(): string {
    return path.join(process.cwd(), CHECKPOINT_DIR, CHECKPOINT_FILENAME);
}

export function readCheckpoint(): CheckpointData | null {
    const checkpointPath = getCheckpointPath();
    if (!fs.existsSync(checkpointPath)) {
        return null;
    }

    const raw = fs.readFileSync(checkpointPath, "utf8");
    return JSON.parse(raw) as CheckpointData;
}

export function writeCheckpoint(data: CheckpointData): string {
    const checkpointPath = getCheckpointPath();
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    fs.writeFileSync(checkpointPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return checkpointPath;
}

export function buildCheckpoint(
    accountId: number,
    subdomain: string,
    window: HistoryWindow,
    lastCompletedDay: string | null
): CheckpointData {
    return {
        accountId,
        subdomain,
        lastCompletedDay,
        windowStart: window.windowStart.toISOString().slice(0, 10),
        windowDays: window.windowDays,
    };
}

export function buildInitialCheckpoint(
    accountId: number,
    subdomain: string,
    window: HistoryWindow
): CheckpointData {
    return buildCheckpoint(accountId, subdomain, window, null);
}

export function writeCheckpointAfterDay(
    accountId: number,
    subdomain: string,
    window: HistoryWindow,
    dayKey: string
): string {
    return writeCheckpoint(
        buildCheckpoint(accountId, subdomain, window, dayKey)
    );
}

export function clearCheckpoint(): void {
    const checkpointPath = getCheckpointPath();
    if (fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
    }
}
