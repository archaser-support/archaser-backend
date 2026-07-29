"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORMULA_OUTPUT_KEY_PREFIX = exports.MAX_FORMULA_AST_DEPTH = exports.MAX_FORMULA_EXPRESSION_LENGTH = exports.MAX_FORMULAS_PER_REPORT = void 0;
exports.getFormulaOutputKey = getFormulaOutputKey;
exports.MAX_FORMULAS_PER_REPORT = 10;
exports.MAX_FORMULA_EXPRESSION_LENGTH = 500;
exports.MAX_FORMULA_AST_DEPTH = 10;
exports.FORMULA_OUTPUT_KEY_PREFIX = "formula:";
function getFormulaOutputKey(formulaId) {
    return `${exports.FORMULA_OUTPUT_KEY_PREFIX}${formulaId}`;
}
//# sourceMappingURL=types.js.map