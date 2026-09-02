"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDirectFormulaDependencyIds = getDirectFormulaDependencyIds;
exports.getDirectFieldReferences = getDirectFieldReferences;
exports.buildFormulaDependencyMap = buildFormulaDependencyMap;
exports.validateFormulaDependencyGraph = validateFormulaDependencyGraph;
exports.topologicalSortFormulas = topologicalSortFormulas;
const parser_1 = require("./parser");
function getDirectFormulaDependencyIds(expression) {
    const ids = [];
    for (const ref of (0, parser_1.extractFieldReferences)(expression)) {
        const id = (0, parser_1.getFormulaIdFromOperandReference)(ref);
        if (id && !ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids;
}
function getDirectFieldReferences(expression) {
    return (0, parser_1.extractFieldReferences)(expression).filter((ref) => !(0, parser_1.isFormulaOperandReference)(ref));
}
function buildFormulaDependencyMap(formulas) {
    return new Map(formulas.map((formula) => [
        formula.id,
        getDirectFormulaDependencyIds(formula.expression),
    ]));
}
function validateFormulaDependencyGraph(formulas) {
    const byId = new Map(formulas.map((formula) => [formula.id, formula]));
    const dependencyMap = buildFormulaDependencyMap(formulas);
    for (const formula of formulas) {
        for (const dependencyId of dependencyMap.get(formula.id) || []) {
            if (dependencyId === formula.id) {
                return { code: "self_reference", formulaId: formula.id };
            }
            if (!byId.has(dependencyId)) {
                return {
                    code: "unknown_formula",
                    formulaId: formula.id,
                    missingId: dependencyId,
                };
            }
        }
    }
    const visiting = new Set();
    const visited = new Set();
    const path = [];
    const visit = (id) => {
        if (visited.has(id)) {
            return null;
        }
        if (visiting.has(id)) {
            const cycleStart = path.indexOf(id);
            return {
                code: "cycle",
                formulaId: id,
                path: [...path.slice(cycleStart), id],
            };
        }
        visiting.add(id);
        path.push(id);
        for (const dependencyId of dependencyMap.get(id) || []) {
            const error = visit(dependencyId);
            if (error) {
                return error;
            }
        }
        path.pop();
        visiting.delete(id);
        visited.add(id);
        return null;
    };
    for (const formula of formulas) {
        const error = visit(formula.id);
        if (error) {
            return error;
        }
    }
    const reachesField = new Map();
    const computeReachesField = (id, stack) => {
        const cached = reachesField.get(id);
        if (cached !== undefined) {
            return cached;
        }
        if (stack.has(id)) {
            return false;
        }
        const formula = byId.get(id);
        if (!formula) {
            return false;
        }
        if (getDirectFieldReferences(formula.expression).length > 0) {
            reachesField.set(id, true);
            return true;
        }
        stack.add(id);
        const result = (dependencyMap.get(id) || []).some((dependencyId) => computeReachesField(dependencyId, stack));
        stack.delete(id);
        reachesField.set(id, result);
        return result;
    };
    for (const formula of formulas) {
        if (!computeReachesField(formula.id, new Set())) {
            return { code: "no_transitive_field", formulaId: formula.id };
        }
    }
    return null;
}
/** Dependencies precede dependents; independent formulas retain input order. */
function topologicalSortFormulas(formulas) {
    if (formulas.length <= 1) {
        return [...formulas];
    }
    const byId = new Map(formulas.map((formula) => [formula.id, formula]));
    const dependencyMap = buildFormulaDependencyMap(formulas);
    const indegree = new Map(formulas.map((formula) => [formula.id, 0]));
    const dependents = new Map(formulas.map((formula) => [formula.id, []]));
    for (const formula of formulas) {
        for (const dependencyId of dependencyMap.get(formula.id) || []) {
            if (!byId.has(dependencyId)) {
                continue;
            }
            indegree.set(formula.id, (indegree.get(formula.id) || 0) + 1);
            dependents.get(dependencyId).push(formula.id);
        }
    }
    const queue = formulas
        .filter((formula) => (indegree.get(formula.id) || 0) === 0)
        .map((formula) => formula.id);
    const ordered = [];
    while (queue.length > 0) {
        const id = queue.shift();
        const formula = byId.get(id);
        if (formula) {
            ordered.push(formula);
        }
        for (const dependentId of dependents.get(id) || []) {
            const next = (indegree.get(dependentId) || 0) - 1;
            indegree.set(dependentId, next);
            if (next === 0) {
                queue.push(dependentId);
            }
        }
    }
    if (ordered.length < formulas.length) {
        const seen = new Set(ordered.map((formula) => formula.id));
        ordered.push(...formulas.filter((formula) => !seen.has(formula.id)));
    }
    return ordered;
}
