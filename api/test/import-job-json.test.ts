import { ImportService } from "../src/import/import.service";

function user() {
    return { sub: "user-1", username: "admin", account_id: 42 };
}

function accessScope() {
    return {
        resolveUserInfo: jest.fn().mockResolvedValue({
            userId: "user-1",
            accountId: 42,
            role: "Admin",
        }),
        getEffectiveAccountId: jest.fn().mockReturnValue(42),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
    };
}

describe("ImportService job JSON", () => {
    it("createJob aliases id as jobId", async () => {
        const created = {
            id: "job-1",
            account_id: 42,
            import_type: "Customer",
            status: "Pending",
        };
        const db = {
            importJob: {
                create: jest.fn().mockResolvedValue(created),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );
        const result = await service.createJob(user(), {
            import_type: "Customer",
            total_records: 2,
        });
        expect(result).toEqual(expect.objectContaining({ jobId: "job-1" }));
    });

    it("getJobById returns records, results, and statistics", async () => {
        const db = {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-1",
                    import_type: "Customer",
                    total_records: 2,
                    successful_records: 1,
                    failed_records: 1,
                    metadata: { field_labels: { name: "Name" } },
                    ImportRecord: [
                        {
                            id: "r1",
                            row_index: 0,
                            status: "Success",
                            original_data: { name: "A" },
                            result_message: "ok",
                            entity_id: 9,
                        },
                        {
                            id: "r2",
                            row_index: 1,
                            status: "Failed",
                            original_data: { name: "B" },
                            result_message: "bad",
                            entity_id: null,
                        },
                    ],
                }),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );
        const result = await service.getJobById(user(), "job-1");
        expect(result.records).toHaveLength(2);
        expect(result.results[0]).toEqual(
            expect.objectContaining({
                index: 0,
                success: true,
                customerId: 9,
            })
        );
        expect(result.statistics).toEqual({
            total: 2,
            successful: 1,
            failed: 1,
        });
        expect(result.metadata).toEqual({ field_labels: { name: "Name" } });
    });
});
