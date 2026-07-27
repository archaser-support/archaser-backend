import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/admin")
export class AdminController {
    constructor(private readonly db: DatabaseService) {}

    private async customersWithEmail() {
        const customers = await this.db.customer.findMany({
            where: {
                Activity: {
                    some: {
                        type: "Email",
                        status: {
                            in: ["SENT", "DELIVERED", "FAILED", "BOUNCED"],
                        },
                        ActivityContact: {
                            some: {
                                Contact: { email: { not: null } },
                            },
                        },
                    },
                },
            },
            select: {
                id: true,
                customer_number: true,
                Person: {
                    select: {
                        first_name: true,
                        last_name: true,
                        full_name: true,
                    },
                },
                Company: { select: { name: true } },
            },
            orderBy: { customer_number: "asc" },
        });
        return customers.map((customer) => {
            let name = customer.customer_number || "Unknown";
            if (customer.Person) {
                name =
                    customer.Person.full_name ||
                    `${customer.Person.first_name || ""} ${customer.Person.last_name || ""}`.trim() ||
                    name;
            } else if (customer.Company) {
                name = customer.Company.name || name;
            }
            return { ...customer, name };
        });
    }

    @Get("email-campaign-accounts")
    @ApiOperation({
        summary: "Accounts/customers with email campaign data (alias)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async emailCampaignAccounts() {
        const accounts = await this.customersWithEmail();
        return serializeBigInt({ accounts });
    }

    @Get("email-campaign-customers")
    @ApiOperation({ summary: "Customers with email campaign data" })
    async emailCampaignCustomers() {
        const customers = await this.customersWithEmail();
        return serializeBigInt({ customers });
    }

    @Get("email-campaign-report")
    @ApiOperation({ summary: "Email campaign report summary" })
    async emailCampaignReport(
        @Query("customerId") customerIdRaw?: string,
        @Query("accountId") accountIdRaw?: string
    ) {
        const customerId = customerIdRaw
            ? parseInt(customerIdRaw, 10)
            : accountIdRaw
              ? parseInt(accountIdRaw, 10)
              : null;
        const where: Record<string, unknown> = {
            type: "Email",
            status: { in: ["SENT", "DELIVERED", "FAILED", "BOUNCED"] },
        };
        if (customerId && Number.isFinite(customerId)) {
            where.customer_id = customerId;
        }
        const [total, delivered, failed, opened] = await Promise.all([
            this.db.activity.count({ where }),
            this.db.activity.count({
                where: { ...where, status: "DELIVERED" },
            }),
            this.db.activity.count({
                where: { ...where, status: { in: ["FAILED", "BOUNCED"] } },
            }),
            this.db.activityContact.count({
                where: {
                    communication_channel: "Email",
                    email_opened_at: { not: null },
                    ...(customerId && Number.isFinite(customerId)
                        ? { Activity: { customer_id: customerId } }
                        : {}),
                },
            }),
        ]);
        return {
            total,
            delivered,
            failed,
            opened,
            customerId: customerId || null,
        };
    }
}
