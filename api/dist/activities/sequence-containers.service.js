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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceContainersService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const VALID_CATEGORIES = [
    "Automated",
    "Promise_to_pay",
    "Dispute",
    "Agent",
    "Legal",
];
const CONTAINER_INCLUDE = {
    _count: { select: { ActivitiesSequence: true } },
};
let SequenceContainersService = class SequenceContainersService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async ctx(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return {
            userInfo,
            accountId: this.accessScope.getEffectiveAccountId(userInfo),
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
            role: userInfo.viewAsUserRole || userInfo.role,
        };
    }
    async assertManage(accountId, role) {
        const ok = await this.accessScope.hasPermission(accountId, role, "manage_sequence_container");
        if (!ok) {
            throw new common_1.ForbiddenException({
                error: "Insufficient permissions. You do not have permission to manage sequence containers.",
            });
        }
    }
    async list(user, category, includeInactive) {
        const { accountId } = await this.ctx(user);
        if (!category) {
            throw new common_1.BadRequestException({
                error: "Category parameter is required",
            });
        }
        if (!VALID_CATEGORIES.includes(category)) {
            throw new common_1.BadRequestException({
                error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
            });
        }
        const where = {
            account_id: accountId,
            category,
            is_deleted: false,
        };
        if (!includeInactive) {
            where.active = true;
        }
        const containers = await this.db.sequenceContainer.findMany({
            where,
            include: CONTAINER_INCLUDE,
            orderBy: [{ is_default: "desc" }, { name: "asc" }],
        });
        return (0, serialize_bigint_1.serializeBigInt)({ data: containers });
    }
    async getById(user, id) {
        const { accountId } = await this.ctx(user);
        const container = await this.db.sequenceContainer.findUnique({
            where: { id },
            include: CONTAINER_INCLUDE,
        });
        if (!container || container.account_id !== accountId) {
            throw new common_1.NotFoundException({
                error: "Sequence container not found",
            });
        }
        return (0, serialize_bigint_1.serializeBigInt)({ data: container });
    }
    async getUsage(user, id) {
        await this.getById(user, id);
        const customerCount = await this.db.customer.count({
            where: { sequence_container_id: id },
        });
        const connectedCustomers = await this.db.customer.findMany({
            where: { sequence_container_id: id },
            select: { id: true, customer_number: true },
            take: 10,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            data: {
                connectedCustomers,
                totalCount: customerCount,
            },
        });
    }
    async create(user, body) {
        const { accountId, effectiveUserId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);
        const name = body.name;
        const category = body.category;
        if (!name || !category) {
            throw new common_1.BadRequestException({
                error: "Name and category are required",
            });
        }
        if (!VALID_CATEGORIES.includes(category)) {
            throw new common_1.BadRequestException({
                error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
            });
        }
        const is_default = Boolean(body.is_default);
        const active = body.active !== false;
        const shouldBeMasterTemplate = accountId === 10013 || Boolean(body.master_template);
        if (category !== "Automated") {
            const existing = await this.db.sequenceContainer.findFirst({
                where: {
                    account_id: accountId,
                    category: category,
                    active: true,
                    is_deleted: false,
                },
            });
            if (existing) {
                throw new common_1.BadRequestException({
                    error: `Only one active sequence container is allowed for category: ${category}`,
                });
            }
        }
        if (is_default) {
            await this.db.sequenceContainer.updateMany({
                where: {
                    account_id: accountId,
                    category: category,
                    is_default: true,
                    is_deleted: false,
                },
                data: { is_default: false },
            });
        }
        const newContainer = await this.db.sequenceContainer.create({
            data: {
                name,
                category: category,
                account_id: accountId,
                is_default,
                active,
                master_template: shouldBeMasterTemplate,
                created_by: effectiveUserId,
                modified_by: effectiveUserId,
            },
            include: CONTAINER_INCLUDE,
        });
        return (0, serialize_bigint_1.serializeBigInt)({ data: newContainer });
    }
    async update(user, id, body) {
        const { accountId, effectiveUserId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);
        await this.getById(user, id);
        const { name, active, is_default, master_template } = body;
        if (is_default) {
            const container = await this.db.sequenceContainer.findUnique({
                where: { id },
                select: { account_id: true, category: true },
            });
            if (container) {
                await this.db.sequenceContainer.updateMany({
                    where: {
                        account_id: container.account_id,
                        category: container.category,
                        is_default: true,
                        NOT: { id },
                    },
                    data: { is_default: false },
                });
            }
        }
        const updated = await this.db.sequenceContainer.update({
            where: { id },
            data: {
                ...(name !== undefined && { name: name }),
                ...(active !== undefined && { active: Boolean(active) }),
                ...(is_default !== undefined && {
                    is_default: Boolean(is_default),
                }),
                ...(master_template !== undefined && {
                    master_template: Boolean(master_template),
                }),
                modified_by: effectiveUserId,
            },
            include: CONTAINER_INCLUDE,
        });
        return (0, serialize_bigint_1.serializeBigInt)({ data: updated });
    }
    async delete(user, id) {
        const { accountId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);
        await this.getById(user, id);
        const details = await this.softDelete(id);
        return {
            message: "Sequence container deleted successfully",
            details,
        };
    }
    async postAction(user, id, body) {
        const { accountId, effectiveUserId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);
        await this.getById(user, id);
        const action = body.action;
        switch (action) {
            case "clone":
                return this.clone(user, id, body, accountId, effectiveUserId);
            case "setDefault":
                return this.setDefault(id, effectiveUserId);
            case "deleteWithReplacement":
                return this.deleteWithReplacement(id, body);
            default:
                throw new common_1.BadRequestException({
                    error: "Invalid action. Supported actions: clone, setDefault, deleteWithReplacement",
                });
        }
    }
    async clone(_user, sourceId, body, accountId, effectiveUserId) {
        const new_name = body.new_name;
        if (!new_name) {
            throw new common_1.BadRequestException({
                error: "New name is required for cloning",
            });
        }
        const source = await this.db.sequenceContainer.findUnique({
            where: { id: sourceId },
            include: {
                ActivitiesSequence: { orderBy: { step: "asc" } },
            },
        });
        if (!source) {
            throw new common_1.NotFoundException({
                error: "Source sequence container not found",
            });
        }
        const set_as_default = Boolean(body.set_as_default);
        if (set_as_default) {
            await this.db.sequenceContainer.updateMany({
                where: {
                    account_id: accountId,
                    category: source.category,
                    is_default: true,
                    is_deleted: false,
                },
                data: { is_default: false },
            });
        }
        const newContainer = await this.db.sequenceContainer.create({
            data: {
                name: new_name,
                category: source.category,
                account_id: accountId,
                is_default: set_as_default,
                active: true,
                master_template: false,
                created_by: effectiveUserId,
                modified_by: effectiveUserId,
            },
            include: CONTAINER_INCLUDE,
        });
        for (const sequence of source.ActivitiesSequence) {
            await this.db.activitiesSequence.create({
                data: {
                    step: sequence.step,
                    active: sequence.active,
                    activity_type: sequence.activity_type,
                    category: sequence.category,
                    days_from_prev_step: sequence.days_from_prev_step,
                    activity_template_id: sequence.activity_template_id,
                    master_template: sequence.master_template,
                    last_category_step: sequence.last_category_step,
                    time_of_day: sequence.time_of_day,
                    account_id: sequence.account_id,
                    sequence_container_id: newContainer.id,
                    send_to_escalated_contacts: sequence.send_to_escalated_contacts,
                    send_to_standard_contacts: sequence.send_to_standard_contacts,
                    step_type: sequence.step_type,
                    days_before_due: sequence.days_before_due,
                    days_after_start: sequence.days_after_start,
                },
            });
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            data: newContainer,
            message: "Sequence container cloned successfully",
        });
    }
    async setDefault(id, effectiveUserId) {
        const container = await this.db.sequenceContainer.findUnique({
            where: { id },
            select: { account_id: true, category: true },
        });
        if (!container) {
            throw new common_1.NotFoundException({
                error: "Sequence container not found",
            });
        }
        await this.db.sequenceContainer.updateMany({
            where: {
                account_id: container.account_id,
                category: container.category,
                is_default: true,
                is_deleted: false,
                NOT: { id },
            },
            data: { is_default: false },
        });
        const updated = await this.db.sequenceContainer.update({
            where: { id },
            data: { is_default: true, modified_by: effectiveUserId },
            include: CONTAINER_INCLUDE,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            data: updated,
            message: "Default sequence container updated successfully",
        });
    }
    async deleteWithReplacement(id, body) {
        const replacementId = Number(body.replacement_sequence_id);
        if (!replacementId) {
            throw new common_1.BadRequestException({
                error: "Replacement sequence ID is required",
            });
        }
        const replacement = await this.db.sequenceContainer.findUnique({
            where: { id: replacementId },
        });
        if (!replacement) {
            throw new common_1.NotFoundException({
                error: `Replacement sequence container ${replacementId} not found`,
            });
        }
        const migration = await this.db.customer.updateMany({
            where: { sequence_container_id: id },
            data: { sequence_container_id: replacementId },
        });
        const details = await this.softDelete(id, true);
        return {
            message: "Sequence container deleted successfully and customers migrated to replacement sequence",
            details: {
                migratedCustomers: migration.count,
                deletedSequences: details.deletedSequences,
                affectedActivities: details.affectedActivities,
            },
        };
    }
    async softDelete(containerId, skipCustomerConstraint = false) {
        const container = await this.db.sequenceContainer.findUnique({
            where: { id: containerId },
        });
        if (!container) {
            throw new common_1.NotFoundException({
                error: `Sequence container ${containerId} not found`,
            });
        }
        if (container.is_deleted) {
            throw new common_1.BadRequestException({
                error: `Sequence container ${containerId} is already deleted`,
            });
        }
        const sequenceCount = await this.db.activitiesSequence.count({
            where: { sequence_container_id: containerId },
        });
        const activityCount = await this.db.activity.count({
            where: {
                ActivitiesSequence: {
                    sequence_container_id: containerId,
                },
            },
        });
        const customerCount = await this.db.customer.count({
            where: { sequence_container_id: containerId },
        });
        await this.db.sequenceContainer.update({
            where: { id: containerId },
            data: { is_deleted: true },
        });
        return {
            deletedSequences: sequenceCount,
            affectedActivities: activityCount,
            affectedCustomers: skipCustomerConstraint ? 0 : customerCount,
        };
    }
};
exports.SequenceContainersService = SequenceContainersService;
exports.SequenceContainersService = SequenceContainersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], SequenceContainersService);
//# sourceMappingURL=sequence-containers.service.js.map