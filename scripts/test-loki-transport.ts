import { lokiTransportService } from "../frontend/server/services/LokiTransportService";
import { LogLevel } from "../frontend/types/MongoLog";

async function testLoki() {
    console.log("🧪 Testing Loki Transport...");

    // Configure env if needed (though existing process.env should be used)
    process.env.ENABLE_LOKI_LOGGING = "true";
    process.env.LOKI_HOST = "http://localhost:3100";

    const testLog = {
        level: LogLevel.INFO,
        message: "This is a test log from the verification script",
        source: "verification-script",
        details: {
            test_id: `test_${Date.now()}`,
            info: "Verifying Loki connectivity",
        },
        correlation_id: `corr_${Date.now()}`,
    };

    try {
        console.log("Sending log:", testLog);
        // We use the internal push method or access the public one?
        // sendLog is fire-and-forget, so errors might be swallowed unless we catch them inside the service
        // But for testing we might want to wait.
        // Let's modify the service slightly or just trust the console output if we enable dev mode?
        // Actually, sendLog is async, it just doesn't await the push.
        // We can't easily wait for the fire-and-forget unless we modify the service or cast it.

        // Let's use the private method via 'any' casting for testing purposes to await it
        await (lokiTransportService as any).pushToLoki(testLog);

        console.log("✅ Log sent successfully to Loki!");
    } catch (error) {
        console.error("❌ Failed to send log:", error);
        process.exit(1);
    }
}

testLoki();
