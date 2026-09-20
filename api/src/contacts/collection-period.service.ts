import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import {
    applyCollectionPeriodCategoryChange,
    COLLECTION_CATEGORIES,
} from "../common/collection-period-category.util";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

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
        if (
            !COLLECTION_CATEGORIES.includes(
                nextCategory as (typeof COLLECTION_CATEGORIES)[number]
            )
        ) {
            throw new BadRequestException({
                error: `Invalid category value. Must be one of: ${COLLECTION_CATEGORIES.join(", ")}`,
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
            if (categoryChanged && period.customer_id != null) {
                await applyCollectionPeriodCategoryChange(tx as never, {
                    collectionPeriodId: id,
                    customerId: period.customer_id,
                    accountId,
                    currentCategory: previousCategory,
                    nextCategory,
                    userId: effectiveUserId,
                    isManual,
                    resetStepToZero,
                });
            } else if (resetStepToZero) {
                await tx.customerCollectionPeriod.update({
                    where: { id },
                    data: {
                        last_automated_step: 0,
                        modified_by: effectiveUserId,
                    } as never,
                });
            }

            return tx.customerCollectionPeriod.findUnique({ where: { id } });
        });

        return serializeBigInt(updated);
    }
}
