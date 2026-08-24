import {
    Controller,
    ForbiddenException,
    Get,
    Query,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const ADMIN_ACCOUNT_ID = 10013;

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/admin")
export class AdminController {
    constructor(private readonly db: DatabaseService) {}

    private assertAdmin(user: JwtPayload) {
        if (
            user.account_id !== ADMIN_ACCOUNT_ID &&
            user.role !== "archaser_admin"
        ) {
            throw new ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }
    }

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
        @Query("accountId") accountIdRaw?: string,
        @Query("startDate") startDate?: string,
        @Query("endDate") endDate?: string,
        @Query("emailType") emailType?: string,
        @Query("page") pageRaw?: string,
        @Query("limit") limitRaw?: string
    ) {
        const customerId = customerIdRaw
            ? parseInt(customerIdRaw, 10)
            : accountIdRaw
              ? parseInt(accountIdRaw, 10)
              : null;
        const page = Math.max(1, parseInt(pageRaw || "1", 10) || 1);
        const limit = Math.min(
            200,
            Math.max(1, parseInt(limitRaw || "50", 10) || 50)
        );
        const activityType =
            emailType === "SMS" || emailType === "WhatsApp"
                ? emailType
                : "Email";

        const where: Record<string, unknown> = {
            type: activityType,
            status: { in: ["SENT", "DELIVERED", "FAILED", "BOUNCED"] },
        };
        if (customerId && Number.isFinite(customerId)) {
            where.customer_id = customerId;
        }
        if (startDate || endDate) {
            const createdAt: Record<string, Date> = {};
            if (startDate) {
                createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
            }
            if (endDate) {
                createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
            }
            where.created_at = createdAt;
        }

        const [
            total,
            sent,
            delivered,
            bounced,
            failed,
            opened,
            clicked,
            rows,
        ] = await Promise.all([
            this.db.activity.count({ where }),
            this.db.activity.count({
                where: { ...where, status: { in: ["SENT", "DELIVERED"] } },
            }),
            this.db.activity.count({
                where: { ...where, status: "DELIVERED" },
            }),
            this.db.activity.count({
                where: { ...where, status: "BOUNCED" },
            }),
            this.db.activity.count({
                where: { ...where, status: { in: ["FAILED", "BOUNCED"] } },
            }),
            this.db.activityContact.count({
                where: {
                    email_opened_at: { not: null },
                    Activity: where,
                },
            }),
            this.db.activityContact.count({
                where: {
                    email_clicked_at: { not: null },
                    Activity: where,
                },
            }),
            this.db.activity.findMany({
                where,
                include: {
                    Customer: {
                        select: {
                            customer_number: true,
                            Account: { select: { name: true } },
                            Person: {
                                select: {
                                    first_name: true,
                                    last_name: true,
                                    full_name: true,
                                },
                            },
                            Company: { select: { name: true } },
                        },
                    },
                    ActivityContact: {
                        take: 1,
                        orderBy: { id: "asc" },
                        include: {
                            Contact: {
                                select: {
                                    email: true,
                                    first_name: true,
                                    last_name: true,
                                    full_name: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { created_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        const rate = (num: number, den: number) =>
            den > 0 ? Math.round((num / den) * 10000) / 100 : 0;

        const data = rows.map((row) => {
            const contact = row.ActivityContact[0];
            const recipient =
                contact?.Contact?.full_name ||
                `${contact?.Contact?.first_name || ""} ${contact?.Contact?.last_name || ""}`.trim();
            return {
                id: String(row.id),
                sendingDateTime: (
                    row.actual_delivery_time ||
                    row.schedule_time ||
                    row.created_at
                ).toISOString(),
                accountName: row.Customer?.Account?.name || "",
                customerCode: row.Customer?.customer_number || "",
                emailType: row.type,
                deliveryStatus: row.status,
                clicked: Boolean(contact?.email_clicked_at),
                opened: Boolean(contact?.email_opened_at),
                viewCount: contact?.email_open_count || 0,
                openedTime: contact?.email_opened_at || undefined,
                clickedTime: contact?.email_clicked_at || undefined,
                recipientEmail:
                    contact?.Contact?.email || row.email || "",
                recipientName: recipient,
            };
        });

        return serializeBigInt({
            summary: {
                totalEmailActivities: total,
                sent,
                delivered,
                bounced,
                failed,
                opened,
                clicked,
                deliveryRate: rate(delivered, sent || total),
                openRate: rate(opened, delivered || total),
                clickRate: rate(clicked, opened || delivered || total),
                bounceRate: rate(bounced, sent || total),
            },
            data,
            pagination: {
                totalRecords: total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
            total,
            delivered,
            failed,
            opened,
            customerId: customerId || null,
        });
    }

    @Get("cron-jobs/stats")
    @ApiOperation({ summary: "Cron job statistics for the admin monitor" })
    async cronJobStats(
        @CurrentUser() user: JwtPayload,
        @Query("jobId") jobIdRaw?: string
    ) {
        this.assertAdmin(user);
        const jobs = await this.db.cronJob.findMany({
            orderBy: { sort_order: "asc" },
            select: {
                id: true,
                name: true,
                active: true,
                last_run_at: true,
                modified_at: true,
            },
        });
        const jobId = jobIdRaw ? parseInt(jobIdRaw, 10) : NaN;
        const selected = Number.isFinite(jobId)
            ? jobs.find((job) => job.id === jobId)
            : null;
        const currentStats = {
            totalJobs: jobs.length,
            activeJobs: jobs.filter((job) => job.active).length,
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            lastExecutionDuration: 0,
            averageDuration: 0,
            lastRunAt: selected?.last_run_at || null,
        };
        return {
            success: true,
            data: {
                currentStats,
                performanceBaseline: 0,
                recentExecutions: [],
                performanceTrend: [],
            },
        };
    }
}
