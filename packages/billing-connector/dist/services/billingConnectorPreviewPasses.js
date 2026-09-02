"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePreviewPassesMap = parsePreviewPassesMap;
exports.previewPassesToPrismaJson = previewPassesToPrismaJson;
exports.clearPreviewPass = clearPreviewPass;
exports.clearPreviewPasses = clearPreviewPasses;
exports.setPreviewPass = setPreviewPass;
exports.setPreviewPasses = setPreviewPasses;
exports.allEnabledEntitiesPreviewPassed = allEnabledEntitiesPreviewPassed;
exports.computeEntityPreviewPassed = computeEntityPreviewPassed;
const priorityApiContract_1 = require("../priority/priorityApiContract");
const ENTITY_KEYS = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];
function isImportType(value) {
    return ENTITY_KEYS.includes(value);
}
function parsePreviewPassesMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!isImportType(key) || !(0, priorityApiContract_1.isPriorityEntityImportType)(key)) {
            continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
        }
        const record = value;
        if (typeof record.passed !== "boolean") {
            continue;
        }
        const completedAt = typeof record.completed_at === "string" && record.completed_at.trim()
            ? record.completed_at.trim()
            : null;
        if (!completedAt) {
            continue;
        }
        out[key] = { passed: record.passed, completed_at: completedAt };
    }
    return out;
}
function previewPassesToPrismaJson(map) {
    return map;
}
function clearPreviewPass(existing, importType) {
    const next = { ...parsePreviewPassesMap(existing) };
    delete next[importType];
    return next;
}
function clearPreviewPasses(existing, importTypes) {
    const next = { ...parsePreviewPassesMap(existing) };
    for (const importType of importTypes) {
        delete next[importType];
    }
    return next;
}
function setPreviewPass(existing, importType, passed, completedAt = new Date()) {
    const next = { ...parsePreviewPassesMap(existing) };
    next[importType] = {
        passed,
        completed_at: completedAt.toISOString(),
    };
    return next;
}
function setPreviewPasses(existing, updates, completedAt = new Date()) {
    let next = parsePreviewPassesMap(existing);
    for (const update of updates) {
        next = setPreviewPass(next, update.importType, update.passed, completedAt);
    }
    return next;
}
/**
 * True when every enabled entity has a stored passing preview.
 */
function allEnabledEntitiesPreviewPassed(enabledEntities, previewPasses) {
    if (enabledEntities.length === 0) {
        return false;
    }
    const map = parsePreviewPassesMap(previewPasses);
    return enabledEntities.every((entity) => map[entity]?.passed === true);
}
/**
 * Entity-level pass from one preview entity result (ignores global cutover info checks).
 */
function computeEntityPreviewPassed(entity) {
    if (entity.validation_errors.length > 0) {
        return false;
    }
    if (entity.sample_rows.length === 0) {
        return false;
    }
    if (entity.import_type === "Invoice" && !entity.sorted_preview) {
        return false;
    }
    return true;
}
