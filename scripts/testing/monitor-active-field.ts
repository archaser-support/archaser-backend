import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function monitorActiveField() {
    try {
        console.log("🔍 Monitoring active field changes...\n");

        // Get all jobs
        const jobs = await prisma.cronJob.findMany({
            select: {
                id: true,
                name: true,
                active: true,
                next_run_at: true,
            },
            orderBy: {
                id: "asc",
            },
        });

        console.log("Initial state:");
        jobs.forEach((job) => {
            console.log(
                `  Job ${job.id} (${job.name}): active = ${job.active}`
            );
        });

        // Find a job that's ready to run
        const now = new Date();
        const readyJob = jobs.find(
            (job) => job.next_run_at && new Date(job.next_run_at) <= now
        );

        if (!readyJob) {
            console.log("\n❌ No jobs are ready to run right now.");
            console.log("Jobs and their next_run_at:");
            jobs.forEach((job) => {
                console.log(
                    `  Job ${job.id} (${job.name}): next_run_at = ${job.next_run_at}`
                );
            });
            return;
        }

        console.log(
            `\n✅ Found ready job: ${readyJob.name} (ID: ${readyJob.id})`
        );
        console.log(`   Current active: ${readyJob.active}`);
        console.log(`   Next run at: ${readyJob.next_run_at}`);

        // Monitor the active field every 500ms for 30 seconds
        console.log("\n📊 Monitoring active field for 30 seconds...");
        const startTime = Date.now();
        const monitorInterval = setInterval(async () => {
            const currentJob = await prisma.cronJob.findUnique({
                where: { id: readyJob.id },
                select: {
                    id: true,
                    name: true,
                    active: true,
                    modified_at: true,
                },
            });

            if (currentJob) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(
                    `[${elapsed}s] Job ${currentJob.id}: active = ${currentJob.active}, modified_at = ${currentJob.modified_at}`
                );
            }
        }, 500);

        // Stop monitoring after 30 seconds
        setTimeout(() => {
            clearInterval(monitorInterval);
            console.log("\n✅ Monitoring stopped.");
            process.exit(0);
        }, 30000);

        // Trigger the cron endpoint
        console.log("\n🚀 Triggering cron endpoint...");
        const cronSecret =
            process.env.CRON_SECRET || "b8638v2eQ7XBL7J3ILNQiFZHVvCAVB3i";
        const baseUrl =
            process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        try {
            const response = await fetch(`${baseUrl}/api/system/cron`, {
                method: "GET",
                headers: {
                    "x-cron-secret": cronSecret,
                },
            });

            const result = await response.json();
            console.log("Cron endpoint response:", result);
        } catch (error) {
            console.error("Error triggering cron endpoint:", error);
        }
    } catch (error) {
        console.error("❌ Error monitoring active field:", error);
    } finally {
        // Don't disconnect immediately - let monitoring continue
        setTimeout(async () => {
            await prisma.$disconnect();
        }, 35000);
    }
}

monitorActiveField();
