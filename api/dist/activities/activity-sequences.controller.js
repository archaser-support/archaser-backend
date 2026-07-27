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
exports.ActivitySequencesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const activities_service_1 = require("./activities.service");
let ActivitySequencesController = class ActivitySequencesController {
    constructor(activities) {
        this.activities = activities;
    }
    async list(user, query) {
        return this.activities.listSequences(user, query);
    }
    async activityTemplates(user, query) {
        return this.activities.listTemplates(user, query);
    }
};
exports.ActivitySequencesController = ActivitySequencesController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({
        summary: "List activity sequences (alias of /api/activities/sequences)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ActivitySequencesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("activityTemplates"),
    (0, swagger_1.ApiOperation)({
        summary: "List activity templates (alias of /api/activities/templates)",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ActivitySequencesController.prototype, "activityTemplates", null);
exports.ActivitySequencesController = ActivitySequencesController = __decorate([
    (0, swagger_1.ApiTags)("activitySequences"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/activitySequences"),
    __metadata("design:paramtypes", [activities_service_1.ActivitiesService])
], ActivitySequencesController);
//# sourceMappingURL=activity-sequences.controller.js.map