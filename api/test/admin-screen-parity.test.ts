import { AdminController } from "../src/admin/admin.controller";
import { UploadController } from "../src/upload/upload.controller";
import { SmsCountryVendorsService } from "../src/sms/sms-country-vendors.service";

describe("admin + upload + SMS mapping JSON", () => {
    it("email campaign report returns summary, data, and pagination", async () => {
        const db = {
            activity: {
                count: jest.fn().mockResolvedValue(2),
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 1n,
                        type: "Email",
                        status: "DELIVERED",
                        email: "a@b.com",
                        created_at: new Date("2026-01-01"),
                        schedule_time: new Date("2026-01-01"),
                        actual_delivery_time: new Date("2026-01-01"),
                        Customer: {
                            customer_number: "C-1",
                            Account: { name: "Acme" },
                            Person: null,
                            Company: { name: "Acme Co" },
                        },
                        ActivityContact: [
                            {
                                email_opened_at: new Date("2026-01-02"),
                                email_clicked_at: null,
                                email_open_count: 1,
                                Contact: {
                                    email: "a@b.com",
                                    first_name: "Ada",
                                    last_name: "L",
                                    full_name: "Ada L",
                                },
                            },
                        ],
                    },
                ]),
            },
            activityContact: { count: jest.fn().mockResolvedValue(1) },
        };
        const controller = new AdminController(db as never);
        const result = await controller.emailCampaignReport(
            undefined,
            undefined,
            "2026-01-01",
            "2026-01-31",
            "Email",
            "1",
            "50"
        );
        expect(result.summary.totalEmailActivities).toBe(2);
        expect(result.data[0]).toEqual(
            expect.objectContaining({
                customerCode: "C-1",
                recipientEmail: "a@b.com",
                opened: true,
            })
        );
        expect(result.pagination.totalRecords).toBe(2);
    });

    it("cron-jobs/stats returns success + data.currentStats", async () => {
        const db = {
            cronJob: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 1, name: "nightly", active: true, last_run_at: null },
                ]),
            },
        };
        const controller = new AdminController(db as never);
        const result = await controller.cronJobStats(
            { sub: "u", username: "a", account_id: 10013, role: "archaser_admin" },
            undefined
        );
        expect(result.success).toBe(true);
        expect(result.data.currentStats.totalJobs).toBe(1);
        expect(result.data.recentExecutions).toEqual([]);
    });

    it("S3 upload aliases filePath and url", async () => {
        const controller = new UploadController();
        const result = await controller.s3(
            { sub: "u", username: "a", account_id: 42 },
            { fileName: "logo.png" }
        );
        expect(result.filePath).toBe(result.key);
        expect(result.url).toBe(result.publicUrl);
    });

    it("SMS country vendors alias mappings", async () => {
        const rows = [{ id: 1, country_id: 2, vendor_id: 3 }];
        const db = {
            countrySMSVendor: {
                findMany: jest.fn().mockResolvedValue(rows),
                count: jest.fn().mockResolvedValue(1),
            },
        };
        const service = new SmsCountryVendorsService(db as never, {
            resolveUserInfo: jest.fn().mockResolvedValue({
                role: "archaser_admin",
                accountId: 10013,
            }),
        } as never);
        const result = await service.list(
            { sub: "u", username: "a", account_id: 10013, role: "archaser_admin" },
            { page: "1", limit: "20" }
        );
        expect(result.mappings).toEqual(rows);
        expect(result.countryVendors).toEqual(rows);
    });
});
