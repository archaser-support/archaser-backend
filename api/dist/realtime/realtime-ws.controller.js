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
exports.RealtimeWsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const realtime_hub_service_1 = require("./realtime-hub.service");
function writeSseHeaders(res, origin) {
    const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    };
    if (origin) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
    }
    res.writeHead(200, headers);
    res.write(": ok\n\n");
}
let RealtimeWsController = class RealtimeWsController {
    constructor(hub) {
        this.hub = hub;
    }
    notifications(req, res, _accessToken) {
        const user = req.user;
        const origin = req.headers.origin;
        writeSseHeaders(res, typeof origin === "string" ? origin : undefined);
        const clientId = `${user.sub}-notif-${Date.now()}`;
        this.hub.addNotificationClient({
            id: clientId,
            userId: user.sub,
            accountId: user.account_id ?? null,
            hasViewAsPermission: false,
            res,
        });
        res.write(`data: ${JSON.stringify({
            type: "connected",
            message: "Notification SSE connected",
            userId: user.sub,
            timestamp: new Date().toISOString(),
        })}\n\n`);
        const heartbeat = setInterval(() => {
            try {
                if (!res.writable || res.destroyed) {
                    clearInterval(heartbeat);
                    return;
                }
                res.write(`: heartbeat ${Date.now()}\n\n`);
            }
            catch {
                clearInterval(heartbeat);
            }
        }, 25000);
        const cleanup = () => {
            clearInterval(heartbeat);
            this.hub.removeNotificationClient(clientId);
        };
        req.on("close", cleanup);
        res.on("close", cleanup);
    }
    controlCenter(req, res, _accessToken) {
        const user = req.user;
        const origin = req.headers.origin;
        writeSseHeaders(res, typeof origin === "string" ? origin : undefined);
        const clientId = `${user.sub}-cc-${Date.now()}`;
        this.hub.addControlCenterClient({
            id: clientId,
            userId: user.sub,
            accountId: user.account_id ?? null,
            hasViewAsPermission: false,
            res,
        });
        res.write(`data: ${JSON.stringify({
            type: "connected",
            message: "Control Center SSE connected",
            userId: user.sub,
        })}\n\n`);
        const heartbeat = setInterval(() => {
            try {
                if (!res.writable || res.destroyed) {
                    clearInterval(heartbeat);
                    return;
                }
                res.write(`: heartbeat ${Date.now()}\n\n`);
            }
            catch {
                clearInterval(heartbeat);
            }
        }, 25000);
        const cleanup = () => {
            clearInterval(heartbeat);
            this.hub.removeControlCenterClient(clientId);
        };
        req.on("close", cleanup);
        res.on("close", cleanup);
    }
};
exports.RealtimeWsController = RealtimeWsController;
__decorate([
    (0, common_1.Get)("notifications"),
    (0, swagger_1.ApiOperation)({
        summary: "SSE notification stream (Nest-owned). EventSource may pass ?access_token= for Amplify cross-origin.",
    }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)("access_token")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", void 0)
], RealtimeWsController.prototype, "notifications", null);
__decorate([
    (0, common_1.Get)("control-center"),
    (0, swagger_1.ApiOperation)({
        summary: "SSE control-center stream (Nest-owned). EventSource may pass ?access_token=.",
    }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)("access_token")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", void 0)
], RealtimeWsController.prototype, "controlCenter", null);
exports.RealtimeWsController = RealtimeWsController = __decorate([
    (0, swagger_1.ApiTags)("realtime"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/ws"),
    __metadata("design:paramtypes", [realtime_hub_service_1.RealtimeHubService])
], RealtimeWsController);
//# sourceMappingURL=realtime-ws.controller.js.map