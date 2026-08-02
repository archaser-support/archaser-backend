"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TTL_SECONDS = exports.LOG_COLLECTION_NAME = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARNING"] = "WARNING";
    LogLevel["ERROR"] = "ERROR";
    LogLevel["CRITICAL"] = "CRITICAL";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
exports.LOG_COLLECTION_NAME = "logs";
exports.DEFAULT_TTL_SECONDS = 5 * 24 * 60 * 60;
//# sourceMappingURL=mongo-log.types.js.map