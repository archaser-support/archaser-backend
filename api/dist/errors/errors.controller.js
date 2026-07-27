"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const database_service_1 = require("../database/database.service");
let ErrorsController = class ErrorsController {
    constructor(db) {
        this.db = db;
    }
    async report(body, userAgentHeader, refererHeader, req) {
        const errorMessage = typeof body.errorMessage === "string"
            ? body.errorMessage
            : "unknown";
        let accountName;
        const accountId = typeof body.accountId === "number"
            ? body.accountId
            : typeof req
                ?.user?.account_id === "number"
                ? req.user
                    .account_id
                : undefined;
        if (accountId != null) {
            try {
                const account = await this.db.account.findUnique({
                    where: { id: accountId },
                    select: { name: true },
                });
                accountName = account?.name ?? undefined;
            }
            catch {
            }
        }
        const context = {
            errorMessage,
            errorName: body.errorName,
            errorDigest: body.errorDigest,
            page: body.page,
            component: body.component,
            userAgent: body.userAgent || userAgentHeader,
            referrer: body.referrer || refererHeader,
            accountId,
            accountName,
            timestamp: new Date().toISOString(),
        };
        console.error("[errors/report]", JSON.stringify(context));
        return {
            success: true,
            received: true,
            timestamp: context.timestamp,
        };
    }
};
exports.ErrorsController = ErrorsController;
__decorate([
    (0, common_1.Post)("report"),
    (0, swagger_1.ApiOperation)({
        summary: "Client error report (Nest-native, structured ack)",
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)("user-agent")),
    __param(2, (0, common_1.Headers)("referer")),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], ErrorsController.prototype, "report", null);
exports.ErrorsController = ErrorsController = __decorate([
    (0, swagger_1.ApiTags)("errors"),
    (0, common_1.Controller)("api/errors"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ErrorsController);
//# sourceMappingURL=errors.controller.js.map