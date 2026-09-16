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
];

function categoryTranslationKey(category: string): string {
    return `customers.values.category_${category
        .toLowerCase()
        .replace(/[_\s]/g, "_")}`;
}

@Injectable()
export class CollectionPeriodService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async getById(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const period = await this.db.customerCollectionPeriod.findUnique({
            where: { id },
            include: { Customer: { select: { account_id: true } } },
        });
        if (!period) {
            throw new NotFoundException({
                error: `Collection period with ID ${id} not found`,
            });
        }
        if (period.Customer?.account_id !== accountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }

        return serializeBigInt(period);
    }

    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);

        const period = await this.db.customerCollectionPeriod.findUnique({
            where: { id },
            select: {
                id: true,
                current_category: true,
                customer_id: true,
                Customer: { select: { account_id: true } },
            },
        });
        if (!period) {
            throw new NotFoundException({
                error: `Collection period with ID ${id} not found`,
            });
        }
        if (period.Customer?.account_id !== accountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }

        const nextCategory = body.current_category as string | undefined;
        if (!nextCategory) {
            throw new BadRequestException({
                error: "current_category is required",
            });
        }
        if (!VALID_CATEGORIES.includes(nextCategory)) {
            throw new BadRequestException({
                error: `Invalid category value. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
                received: nextCategory,
            });
        }

        const previousCategory = period.current_category;
        const resetStepToZero = Boolean(body.resetStepToZero);
        const isManual = body.isManualCategoryChange === true;

        if (previousCategory === nextCategory && !resetStepToZero) {
            throw new BadRequestException({
                error: "Category is already set to the requested value",
                current_category: previousCategory,
            });
        }

        const categoryChanged = previousCategory !== nextCategory;

        const updated = await this.db.$transaction(async (tx) => {
            const updateData: Record<string, unknown> = {
                current_category: nextCategory,
                modified_by: effectiveUserId,
            };

            if (categoryChanged) {
                // Match cron moveCollectionToNextCategory slim update.
                updateData.previous_category = previousCategory;
                updateData.next_category = null;
                updateData.next_category_date = null;

                if (nextCategory === "Automated") {
                    if (
                        previousCategory === "Promise_to_pay" ||
                        previousCategory === "Dispute"
                    ) {
                        updateData.is_last_automated_step_delivered = false;
                        updateData.create_next_activity = true;
                        if (resetStepToZero || isManual) {
                            // UI always resets step when choosing Automated.
                            updateData.last_automated_step = 0;
                        }
                    } else {
                        updateData.last_automated_step = 0;
                        updateData.is_last_automated_step_delivered = false;
                        updateData.create_next_activity = true;
                    }
                } else if (resetStepToZero) {
                    updateData.last_automated_step = 0;
                }
            } else if (resetStepToZero) {
                updateData.last_automated_step = 0;
            }

            const next = await tx.customerCollectionPeriod.update({
                where: { id },
                data: updateData as never,
            });

            if (categoryChanged) {
                const leavingAutomatedOrPtp =
                    previousCategory === "Automated" ||
                    previousCategory === "Promise_to_pay";
                if (leavingAutomatedOrPtp) {
                    await tx.activity.updateMany({
                        where: {
                            collection_period_id: id,
                            status: { in: ["SCHEDULED", "PAUSED"] },
                        },
                        data: {
                            status: "CANCELLED",
                            modified_at: new Date(),
                            modified_by: effectiveUserId,
                        } as never,
                    });
                }

                if (previousCategory === "Promise_to_pay") {
                    await tx.activity.deleteMany({
                        where: {
                            collection_period_id: id,
                            ActivitiesSequence: {
                                category: "Promise_to_pay",
                            },
                            status: { in: ["SCHEDULED", "PAUSED"] },
                        },
                    });
                }

                if (period.customer_id != null) {
                    const nextCategoryKey =
                        categoryTranslationKey(nextCategory);
                    const title = previousCategory
                        ? "{{activities.fields.category_change}}"
                        : "{{activities.fields.category_change_to}}";
                    const titleParams: Record<string, string> =
                        previousCategory
                            ? {
                                  oldCategory:
                                      categoryTranslationKey(previousCategory),
                                  newCategory: nextCategoryKey,
                                  userId: effectiveUserId,
                              }
                            : {
                                  newCategory: nextCategoryKey,
                                  userId: effectiveUserId,
                              };
                    const now = new Date();
                    await tx.activity.create({
                        data: {
                            customer_id: period.customer_id,
                            account_id: accountId,
                            collection_period_id: id,
                            type: "Internal",
                            title,
                            title_params: titleParams,
                            content: "",
                            schedule_time: now,
                            actual_delivery_time: now,
                            status: "COMPLETED",
                            system_generated: !isManual,
                            created_by: effectiveUserId,
                            modified_by: effectiveUserId,
                        } as never,
                    });
                }
            }

            return next;
        });

        return serializeBigInt(updated);
    }
}
