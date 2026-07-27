# Console Log Debugging System

This system allows you to capture, save, and analyze console logs from your frontend application without manually copying and pasting from the browser console.

## How It Works

1. **DebugConsoleLogger Component**: Intercepts console logs in the browser and sends them to an API endpoint
2. **API Endpoint**: Receives logs and saves them to a JSONL file (`debug-logs/console-logs.jsonl`)
3. **Analysis Script**: Reads and analyzes the saved logs to provide insights

## Setup

The system is already integrated into your app. The `DebugConsoleLogger` component is added to the root layout and will automatically start capturing logs in development mode.

## Usage

### 1. Generate Logs

Start your development server and use your application. Any console logs containing `[ReportViewer]` (or the filter you configure) will be automatically captured and saved.

```bash
npm run dev
```

### 2. Analyze Logs

After generating some logs, analyze them:

```bash
# Full analysis with insights
npm run debug:logs analyze

# Or use the short form
npm run debug:logs a
```

### 3. View Recent Logs

View the last N log entries:

```bash
# Last 20 entries (default)
npm run debug:logs tail

# Last 50 entries
npm run debug:logs tail 50
```

### 4. Clear Logs

Clear the log file to start fresh:

```bash
npm run debug:logs clear

# Or use the short form
npm run debug:logs c
```

## Configuration

### Change the Log Filter

Edit `components/DebugConsoleLogger.tsx` and modify the `DEBUG_LOG_FILTER` constant:

```typescript
const DEBUG_LOG_FILTER = "[ReportViewer]"; // Change this to filter different logs
```

Set to `null` or empty string to capture all logs:

```typescript
const DEBUG_LOG_FILTER = null; // Capture all logs
```

### Change Log Buffer Settings

In `components/DebugConsoleLogger.tsx`, you can adjust:

- **Buffer size**: Change `50` to flush more/less frequently
- **Flush interval**: Change `2000` (2 seconds) to flush at different intervals

## Log File Location

Logs are saved to: `debug-logs/console-logs.jsonl`

This file is in JSONL format (one JSON object per line), making it easy to parse and analyze.

## Analysis Features

The analysis script provides:

- **Component grouping**: Shows how many logs per component
- **Level grouping**: Shows log distribution by level (log, error, warn, info)
- **Alignment check analysis**: Special analysis for grid alignment logs
- **Error detection**: Highlights any errors found
- **Width measurements**: Detailed cell width comparisons for alignment issues

## Example Output

```
📊 Analyzing 15 log entries...

📦 Logs by component:
  ReportViewer: 15 entries

📈 Logs by level:
  log: 15 entries

🔍 Alignment Check Analysis:

--- Alignment Check #1 ---
Timestamp: 2024-01-15T10:30:45.123Z
Component: ReportViewer
Has Header Row: true
Has Data Row: true
Header Cells Count: 5
Data Row Cells Count: 5
Header Total Width: 1200
Data Row Total Width: 1198
Total Width Difference: 2

Misalignments: 1
  1. Field: amount, Diff: 2px

Header Cell Widths:
  1. __rowNumber: 50px (flex: none)
  2. Customer.name: 200px (flex: 1)
  3. Invoice.amount: 150px (flex: none)
  ...
```

## Troubleshooting

### No logs are being captured

1. Make sure you're in development mode (`NODE_ENV=development`)
2. Check that the log message contains the filter string (default: `[ReportViewer]`)
3. Verify the API endpoint is accessible: `http://localhost:3000/api/debug/console-logs`

### Logs are too large

1. Adjust the filter to be more specific
2. Reduce the buffer size in `DebugConsoleLogger.tsx`
3. Clear logs more frequently

### API errors

The logger silently fails if the API is unavailable, so it won't break your app. Check:
- The API endpoint exists: `pages/api/debug/console-logs.ts`
- The `debug-logs` directory is writable
- You're in development mode

## Notes

- Logs are only captured in development mode
- The system automatically flushes logs every 2 seconds or when 50 entries accumulate
- Logs are appended to the file, so they persist across app restarts
- The log file is gitignored and won't be committed

