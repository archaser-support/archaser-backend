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

        const currentCategory = body.current_category as string | undefined;
        if (!currentCategory) {
            throw new BadRequestException({
                error: "current_category is required",
            });
        }
        if (!VALID_CATEGORIES.includes(currentCategory)) {
            throw new BadRequestException({
                error: `Invalid category value. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
                received: currentCategory,
            });
        }

        const updated = await this.db.customerCollectionPeriod.update({
            where: { id },
            data: {
                current_category: currentCategory,
                ...(body.resetStepToZero ? { last_automated_step: 0 } : {}),
            } as never,
        });

        return serializeBigInt(updated);
    }
}
