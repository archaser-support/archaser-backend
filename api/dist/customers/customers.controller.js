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
exports.CustomersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const customer_checkpoint_service_1 = require("./customer-checkpoint.service");
const customers_service_1 = require("./customers.service");
let CustomersController = class CustomersController {
    constructor(customers, checkpoints) {
        this.customers = customers;
        this.checkpoints = checkpoints;
    }
    async list(user, query) {
        return this.customers.listOrStats(user, query);
    }
    async byId(user, id) {
        return this.customers.getById(user, id);
    }
    async update(user, id, body) {
        return this.customers.update(user, id, body);
    }
    async activity(user, id, query) {
        return this.customers.listActivities(user, id, query);
    }
    async disputes(user, id) {
        return this.customers.listDisputes(user, id);
    }
    async policies(user, id) {
        return this.customers.listPolicies(user, id);
    }
    async topUps(user, id, query) {
        return this.customers.listTopUps(user, id, query);
    }
    async createTopUp(user, id, body) {
        return this.customers.createTopUp(user, id, body);
    }
    async cancelTopUp(user, id, topUpId) {
        return this.customers.cancelTopUp(user, id, topUpId);
    }
    async checkpointStatus(user, id) {
        return this.checkpoints.getStatus(user, id);
    }
    async checkpointSave(user, id) {
        return this.checkpoints.save(user, id);
    }
    async checkpointRestore(user, id) {
        return this.checkpoints.restore(user, id);
    }
    async stuckActivities(user, id) {
        return this.customers.stuckActivities(user, id);
    }
    async invoicesAvailableForDispute(user, id) {
        return this.customers.invoicesAvailableForDispute(user, id);
    }
    async logCallActivity(user, id, body) {
        return this.customers.logCallActivity(user, id, body);
    }
    async sendEmail(user, id, body) {
        return this.customers.sendEmailActivity(user, id, body);
    }
    async updateDispute(user, id, disputeId, op, body) {
        return this.customers.updateDispute(user, id, disputeId, op, body);
    }
};
exports.CustomersController = CustomersController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "Customers list / stats (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Customer detail (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "byId", null);
__decorate([
    (0, common_1.Put)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Customer update (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "update", null);
__decorate([
    (0, common_1.Get)(":id/activity"),
    (0, swagger_1.ApiOperation)({ summary: "Customer activity feed (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "activity", null);
__decorate([
    (0, common_1.Get)(":id/disputes"),
    (0, swagger_1.ApiOperation)({ summary: "Customer disputes list (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "disputes", null);
__decorate([
    (0, common_1.Get)(":id/policies"),
    (0, swagger_1.ApiOperation)({ summary: "Customer policies list (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "policies", null);
__decorate([
    (0, common_1.Get)(":id/top-ups"),
    (0, swagger_1.ApiOperation)({ summary: "Customer top-ups list (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "topUps", null);
__decorate([
    (0, common_1.Post)(":id/top-ups"),
    (0, swagger_1.ApiOperation)({ summary: "Create a customer top-up (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "createTopUp", null);
__decorate([
    (0, common_1.Delete)(":id/top-ups/:topUpId"),
    (0, swagger_1.ApiOperation)({ summary: "Cancel a customer top-up (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("topUpId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "cancelTopUp", null);
__decorate([
    (0, common_1.Get)(":id/checkpoint"),
    (0, swagger_1.ApiOperation)({ summary: "Customer checkpoint status (non-production only)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "checkpointStatus", null);
__decorate([
    (0, common_1.Post)(":id/checkpoint/save"),
    (0, swagger_1.ApiOperation)({ summary: "Save a customer checkpoint (non-production only)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "checkpointSave", null);
__decorate([
    (0, common_1.Post)(":id/checkpoint/restore"),
    (0, swagger_1.ApiOperation)({
        summary: "Restore a customer checkpoint (non-production only)",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "checkpointRestore", null);
__decorate([
    (0, common_1.Get)(":id/stuck-activities"),
    (0, swagger_1.ApiOperation)({ summary: "Customer stuck-activities flag (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "stuckActivities", null);
__decorate([
    (0, common_1.Get)(":id/invoices-available-for-dispute"),
    (0, swagger_1.ApiOperation)({ summary: "Invoices selectable for a dispute (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "invoicesAvailableForDispute", null);
__decorate([
    (0, common_1.Post)(":id/activity/log-call-activity"),
    (0, swagger_1.ApiOperation)({ summary: "Log a call activity (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "logCallActivity", null);
__decorate([
    (0, common_1.Post)(":id/activity/send-email"),
    (0, swagger_1.ApiOperation)({ summary: "Send a customer email activity (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "sendEmail", null);
__decorate([
    (0, common_1.Put)(":id/disputes/:disputeId/:op"),
    (0, swagger_1.ApiOperation)({ summary: "Update a customer dispute (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("disputeId", common_1.ParseIntPipe)),
    __param(3, (0, common_1.Param)("op")),
    __param(4, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number, String, Object]),
    __metadata("design:returntype", Promise)
], CustomersController.prototype, "updateDispute", null);
exports.CustomersController = CustomersController = __decorate([
    (0, swagger_1.ApiTags)("entities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/customers"),
    __metadata("design:paramtypes", [customers_service_1.CustomersService,
        customer_checkpoint_service_1.CustomerCheckpointService])
], CustomersController);
//# sourceMappingURL=customers.controller.js.map