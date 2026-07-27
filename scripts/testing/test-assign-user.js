import fs from "fs";
import path from "path";

// Function to check recent log files
function checkLogs() {
    console.log("=== Checking for recent log files ===");

    const logDir = "/var/log/archaser";
    if (fs.existsSync(logDir)) {
        const files = fs.readdirSync(logDir);
        const logFiles = files.filter((file) => file.endsWith(".log"));

        console.log(`Found ${logFiles.length} log files in ${logDir}:`);
        logFiles.forEach((file) => {
            const filePath = path.join(logDir, file);
            const stats = fs.statSync(filePath);
            console.log(
                `- ${file} (${stats.size} bytes, modified: ${stats.mtime})`
            );
        });

        // Check the most recent log file for assign-user related entries
        if (logFiles.length > 0) {
            const mostRecent = logFiles.sort((a, b) => {
                const aPath = path.join(logDir, a);
                const bPath = path.join(logDir, b);
                return fs.statSync(bPath).mtime - fs.statSync(aPath).mtime;
            })[0];

            const logPath = path.join(logDir, mostRecent);
            console.log(
                `\n=== Checking most recent log file: ${mostRecent} ===`
            );

            const content = fs.readFileSync(logPath, "utf8");
            const lines = content.split("\n");

            // Look for assign-user related entries
            const assignUserLines = lines.filter(
                (line) =>
                    line.includes("assign-user") ||
                    line.includes("assignUserToDispute") ||
                    line.includes("DisputeService.assignUserToDispute")
            );

            if (assignUserLines.length > 0) {
                console.log(
                    `Found ${assignUserLines.length} assign-user related log entries:`
                );
                assignUserLines.slice(-10).forEach((line) => console.log(line));
            } else {
                console.log("No assign-user related log entries found.");
            }

            // Look for error entries
            const errorLines = lines.filter(
                (line) =>
                    line.includes("ERROR") ||
                    line.includes("error") ||
                    line.includes("500")
            );

            if (errorLines.length > 0) {
                console.log(
                    `\nFound ${errorLines.length} error-related log entries:`
                );
                errorLines.slice(-10).forEach((line) => console.log(line));
            }
        }
    } else {
        console.log(`Log directory ${logDir} does not exist.`);
        console.log("Checking if we can create logs in development mode...");

        // Check if we're in development mode
        if (process.env.NODE_ENV !== "production") {
            console.log(
                "Running in development mode. Logs will be written to console only."
            );
        }
    }
}

// Function to test the assign-user endpoint
async function testAssignUser() {
    console.log("\n=== Testing assign-user endpoint ===");

    const testData = {
        customerId: "1447",
        disputeId: "448",
        assignee: "test-user-id", // Replace with actual user ID
        userComment: "Test assignment from script",
    };

    try {
        const response = await fetch(
            `http://localhost:3000/api/customers/${testData.customerId}/disputes/${testData.disputeId}/assign-user`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    // Add authentication headers if needed
                },
                body: JSON.stringify({
                    assignee: testData.assignee,
                    user_comment: testData.userComment,
                }),
            }
        );

        const data = await response.json();

        console.log(`Response status: ${response.status}`);
        console.log("Response data:", JSON.stringify(data, null, 2));

        if (!response.ok) {
            console.error("Request failed:", data);
        }
    } catch (error) {
        console.error("Error testing assign-user endpoint:", error.message);
    }
}

// Main execution
async function main() {
    console.log("=== Assign-User Debug Script ===");
    console.log(`Current time: ${new Date().toISOString()}`);
    console.log(`Node environment: ${process.env.NODE_ENV || "development"}`);

    checkLogs();

    // Uncomment the line below to test the endpoint
    // await testAssignUser();

    console.log("\n=== Debug script completed ===");
    console.log(
        "To test the endpoint, uncomment the testAssignUser() call in the script."
    );
}

main().catch(console.error);
