import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const VALID_CATEGORIES = [
    "Automated",
    "Promise_to_pay",
    "Dispute",
    "Agent",
    "Legal",
] as const;

const CONTAINER_INCLUDE = {
    _count: { select: { ActivitiesSequence: true } },
} as const;

@Injectable()
export class SequenceContainersService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async ctx(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return {
            userInfo,
            accountId: this.accessScope.getEffectiveAccountId(userInfo),
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
            role: userInfo.viewAsUserRole || userInfo.role,
        };
    }

    private async assertManage(accountId: number, role: string) {
        const ok = await this.accessScope.hasPermission(
            accountId,
            role,
            "manage_sequence_container"
        );
        if (!ok) {
            throw new ForbiddenException({
                error: "Insufficient permissions. You do not have permission to manage sequence containers.",
            });
        }
    }

    async list(
        user: JwtPayload,
        category: string,
        includeInactive: boolean
    ) {
        const { accountId } = await this.ctx(user);
        if (!category) {
            throw new BadRequestException({
                error: "Category parameter is required",
            });
        }
        if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
            throw new BadRequestException({
                error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
            });
        }

        const where: Record<string, unknown> = {
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
        return serializeBigInt({ data: containers });
    }

    async getById(user: JwtPayload, id: number) {
        const { accountId } = await this.ctx(user);
        const container = await this.db.sequenceContainer.findUnique({
            where: { id },
            include: CONTAINER_INCLUDE,
        });
        if (!container || container.account_id !== accountId) {
            throw new NotFoundException({
                error: "Sequence container not found",
            });
        }
        return serializeBigInt({ data: container });
    }

    async getUsage(user: JwtPayload, id: number) {
        await this.getById(user, id);
        const customerCount = await this.db.customer.count({
            where: { sequence_container_id: id },
        });
        const connectedCustomers = await this.db.customer.findMany({
            where: { sequence_container_id: id },
            select: { id: true, customer_number: true },
            take: 10,
        });
        return serializeBigInt({
            data: {
                connectedCustomers,
                totalCount: customerCount,
            },
        });
    }

    async create(user: JwtPayload, body: Record<string, unknown>) {
        const { accountId, effectiveUserId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);

        const name = body.name as string;
        const category = body.category as string;
        if (!name || !category) {
            throw new BadRequestException({
                error: "Name and category are required",
            });
        }
        if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
            throw new BadRequestException({
                error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
            });
        }

        const is_default = Boolean(body.is_default);
        const active = body.active !== false;
        const shouldBeMasterTemplate =
            accountId === 10013 || Boolean(body.master_template);

        if (category !== "Automated") {
            const existing = await this.db.sequenceContainer.findFirst({
                where: {
                    account_id: accountId,
                    category: category as never,
                    active: true,
                    is_deleted: false,
                },
            });
            if (existing) {
                throw new BadRequestException({
                    error: `Only one active sequence container is allowed for category: ${category}`,
                });
            }
        }

        if (is_default) {
            await this.db.sequenceContainer.updateMany({
                where: {
                    account_id: accountId,
                    category: category as never,
                    is_default: true,
                    is_deleted: false,
                },
                data: { is_default: false },
            });
        }

        const newContainer = await this.db.sequenceContainer.create({
            data: {
                name,
                category: category as never,
                account_id: accountId,
                is_default,
                active,
                master_template: shouldBeMasterTemplate,
                created_by: effectiveUserId,
                modified_by: effectiveUserId,
            },
            include: CONTAINER_INCLUDE,
        });
        return serializeBigInt({ data: newContainer });
    }

    async update(user: JwtPayload, id: number, body: Record<string, unknown>) {
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
                ...(name !== undefined && { name: name as string }),
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
        return serializeBigInt({ data: updated });
    }

    async delete(user: JwtPayload, id: number) {
        const { accountId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);
        await this.getById(user, id);
        const details = await this.softDelete(id);
        return {
            message: "Sequence container deleted successfully",
            details,
        };
    }

    async postAction(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const { accountId, effectiveUserId, role } = await this.ctx(user);
        await this.assertManage(accountId, role);
        await this.getById(user, id);

        const action = body.action as string;
        switch (action) {
            case "clone":
                return this.clone(user, id, body, accountId, effectiveUserId);
            case "setDefault":
                return this.setDefault(id, effectiveUserId);
            case "deleteWithReplacement":
                return this.deleteWithReplacement(id, body);
            default:
                throw new BadRequestException({
                    error: "Invalid action. Supported actions: clone, setDefault, deleteWithReplacement",
                });
        }
    }

    private async clone(
        _user: JwtPayload,
        sourceId: number,
        body: Record<string, unknown>,
        accountId: number,
        effectiveUserId: string
    ) {
        const new_name = body.new_name as string;
        if (!new_name) {
            throw new BadRequestException({
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
            throw new NotFoundException({
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
                    send_to_escalated_contacts:
                        sequence.send_to_escalated_contacts,
                    send_to_standard_contacts:
                        sequence.send_to_standard_contacts,
                    step_type: sequence.step_type,
                    days_before_due: sequence.days_before_due,
                    days_after_start: sequence.days_after_start,
                },
            });
        }

        return serializeBigInt({
            data: newContainer,
            message: "Sequence container cloned successfully",
        });
    }

    private async setDefault(id: number, effectiveUserId: string) {
        const container = await this.db.sequenceContainer.findUnique({
            where: { id },
            select: { account_id: true, category: true },
        });
        if (!container) {
            throw new NotFoundException({
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

        return serializeBigInt({
            data: updated,
            message: "Default sequence container updated successfully",
        });
    }

    private async deleteWithReplacement(
        id: number,
        body: Record<string, unknown>
    ) {
        const replacementId = Number(body.replacement_sequence_id);
        if (!replacementId) {
            throw new BadRequestException({
                error: "Replacement sequence ID is required",
            });
        }

        const replacement = await this.db.sequenceContainer.findUnique({
            where: { id: replacementId },
        });
        if (!replacement) {
            throw new NotFoundException({
                error: `Replacement sequence container ${replacementId} not found`,
            });
        }

        const migration = await this.db.customer.updateMany({
            where: { sequence_container_id: id },
            data: { sequence_container_id: replacementId },
        });

        const details = await this.softDelete(id, true);
        return {
            message:
                "Sequence container deleted successfully and customers migrated to replacement sequence",
            details: {
                migratedCustomers: migration.count,
                deletedSequences: details.deletedSequences,
                affectedActivities: details.affectedActivities,
            },
        };
    }

    private async softDelete(
        containerId: number,
        skipCustomerConstraint = false
    ) {
        const container = await this.db.sequenceContainer.findUnique({
            where: { id: containerId },
        });
        if (!container) {
            throw new NotFoundException({
                error: `Sequence container ${containerId} not found`,
            });
        }
        if (container.is_deleted) {
            throw new BadRequestException({
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
}
