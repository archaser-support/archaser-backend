import fs from "fs";
import path from "path";

interface LogEntry {
    level: string;
    message: string;
    data?: any;
    timestamp: string;
    component?: string;
    stack?: string;
}

const DEBUG_LOGS_DIR = path.join(process.cwd(), "debug-logs");
const LOG_FILE = path.join(DEBUG_LOGS_DIR, "console-logs.jsonl");

function readLogFile(): LogEntry[] {
    if (!fs.existsSync(LOG_FILE)) {
        console.log("No log file found. Start the app and generate some logs.");
        return [];
    }

    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.trim());

    return lines.map((line) => {
        try {
            return JSON.parse(line) as LogEntry;
        } catch (error) {
            console.error(`Failed to parse line: ${line}`);
            return null;
        }
    }).filter((entry): entry is LogEntry => entry !== null);
}

function analyzeLogs(logs: LogEntry[]) {
    if (logs.length === 0) {
        console.log("No logs to analyze.");
        return;
    }

    console.log(`\n📊 Analyzing ${logs.length} log entries...\n`);

    // Group by component
    const byComponent = new Map<string, LogEntry[]>();
    logs.forEach((log) => {
        const component = log.component || "unknown";
        if (!byComponent.has(component)) {
            byComponent.set(component, []);
        }
        byComponent.get(component)!.push(log);
    });

    console.log("📦 Logs by component:");
    byComponent.forEach((componentLogs, component) => {
        console.log(`  ${component}: ${componentLogs.length} entries`);
    });

    // Group by level
    const byLevel = new Map<string, LogEntry[]>();
    logs.forEach((log) => {
        if (!byLevel.has(log.level)) {
            byLevel.set(log.level, []);
        }
        byLevel.get(log.level)!.push(log);
    });

    console.log("\n📈 Logs by level:");
    byLevel.forEach((levelLogs, level) => {
        console.log(`  ${level}: ${levelLogs.length} entries`);
    });

    // Find alignment check logs
    const alignmentLogs = logs.filter((log) =>
        log.message.includes("alignment check")
    );

    if (alignmentLogs.length > 0) {
        console.log("\n🔍 Alignment Check Analysis:");
        alignmentLogs.forEach((log, idx) => {
            console.log(`\n--- Alignment Check #${idx + 1} ---`);
            console.log(`Timestamp: ${log.timestamp}`);
            console.log(`Component: ${log.component || "unknown"}`);

            if (log.data && typeof log.data === "object") {
                // Extract key metrics
                const data = log.data as any;
                console.log(`Has Header Row: ${data.hasHeaderRow}`);
                console.log(`Has Data Row: ${data.hasDataRow}`);
                console.log(`Header Cells Count: ${data.headerCellsCount}`);
                console.log(`Data Row Cells Count: ${data.dataRowCellsCount}`);
                console.log(`Header Total Width: ${data.headerTotalWidth}`);
                console.log(`Data Row Total Width: ${data.dataRowTotalWidth}`);
                console.log(`Total Width Difference: ${data.totalWidthDifference}`);

                if (data.misalignments && Array.isArray(data.misalignments)) {
                    console.log(`\nMisalignments: ${data.misalignments.length}`);
                    data.misalignments.forEach((mis: any, i: number) => {
                        console.log(
                            `  ${i + 1}. Field: ${mis.field}, Diff: ${mis.widthDifference}px`
                        );
                    });
                }

                if (data.headerCellData && Array.isArray(data.headerCellData)) {
                    console.log("\nHeader Cell Widths:");
                    data.headerCellData.forEach((cell: any, i: number) => {
                        console.log(
                            `  ${i + 1}. ${cell.field}: ${cell.width}px (flex: ${cell.flex || "none"})`
                        );
                    });
                }

                if (data.dataRowCellData && Array.isArray(data.dataRowCellData)) {
                    console.log("\nData Row Cell Widths:");
                    data.dataRowCellData.forEach((cell: any, i: number) => {
                        console.log(`  ${i + 1}. ${cell.width}px (flex: ${cell.flex || "none"})`);
                    });
                }
            }
        });
    }

    // Find errors
    const errors = logs.filter((log) => log.level === "error");
    if (errors.length > 0) {
        console.log("\n❌ Errors found:");
        errors.forEach((error, idx) => {
            console.log(`\n--- Error #${idx + 1} ---`);
            console.log(`Message: ${error.message}`);
            if (error.stack) {
                console.log(`Stack: ${error.stack.split("\n").slice(0, 5).join("\n")}`);
            }
        });
    }
}

function clearLogs() {
    if (fs.existsSync(LOG_FILE)) {
        fs.unlinkSync(LOG_FILE);
        console.log("✅ Log file cleared.");
    } else {
        console.log("No log file to clear.");
    }
}

// Main
const command = process.argv[2];

switch (command) {
    case "analyze":
    case "a":
        const logs = readLogFile();
        analyzeLogs(logs);
        break;

    case "clear":
    case "c":
        clearLogs();
        break;

    case "tail":
    case "t":
        // Show last N entries
        const n = parseInt(process.argv[3] || "20", 10);
        const allLogs = readLogFile();
        const recentLogs = allLogs.slice(-n);
        console.log(`\n📋 Last ${recentLogs.length} log entries:\n`);
        recentLogs.forEach((log) => {
            console.log(`[${log.timestamp}] [${log.level}] ${log.component || ""}: ${log.message.substring(0, 100)}`);
        });
        break;

    default:
        console.log(`
Usage: npm run debug:logs <command>

Commands:
  analyze, a    - Analyze all logs and show insights
  clear, c      - Clear the log file
  tail, t [n]   - Show last n entries (default: 20)

Examples:
  npm run debug:logs analyze
  npm run debug:logs tail 50
  npm run debug:logs clear
        `);
}

