#!/bin/bash

# Script to run eslint --fix in a loop until all errors and warnings are fixed
# Usage: ./scripts/fix-eslint-loop.sh [max_iterations]

MAX_ITERATIONS=${1:-50}
ITERATION=0

echo "🔧 Starting ESLint auto-fix loop..."
echo "📊 Max iterations: $MAX_ITERATIONS"
echo ""

# Function to count ESLint errors and warnings
count_eslint_issues() {
    # Run eslint without --fix and capture output
    # Use JSON format for reliable parsing, then count issues
    local output=$(npx eslint . --format=json 2>/dev/null)
    local exit_code=$?
    
    # If eslint exits with 0, there are no issues
    if [ $exit_code -eq 0 ]; then
        echo "0"
        return 0
    fi
    
    # Parse JSON output to count total issues
    # The JSON format has an array of results, each with errorCount and warningCount
    # Use node to parse JSON if available, otherwise fall back to grep
    if command -v node &> /dev/null; then
        local count=$(echo "$output" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
                const total = Array.isArray(data) 
                    ? data.reduce((sum, file) => sum + (file.errorCount || 0) + (file.warningCount || 0), 0)
                    : 0;
                console.log(total);
            } catch (e) {
                console.log('0');
            }
        " 2>/dev/null)
        echo "${count:-0}"
    else
        # Fallback: count error/warning keywords in compact format
        npx eslint . --format=compact 2>&1 | grep -cE "(error|warning)" || echo "0"
    fi
}

# Function to get detailed issue information
get_issue_details() {
    local output=$(npx eslint . --format=json 2>/dev/null)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo ""
        return 0
    fi
    
    if command -v node &> /dev/null; then
        echo "$output" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
                if (Array.isArray(data)) {
                    const filesWithIssues = data.filter(f => (f.errorCount || 0) + (f.warningCount || 0) > 0);
                    if (filesWithIssues.length > 0) {
                        console.log('📁 Files with issues:');
                        filesWithIssues.slice(0, 10).forEach(file => {
                            const total = (file.errorCount || 0) + (file.warningCount || 0);
                            console.log(\`   - \${file.filePath}: \${total} issue(s)\`);
                        });
                        if (filesWithIssues.length > 10) {
                            console.log(\`   ... and \${filesWithIssues.length - 10} more file(s)\`);
                        }
                    }
                }
            } catch (e) {
                // Ignore parsing errors
            }
        " 2>/dev/null
    fi
}

# Function to run eslint --fix with progress display
run_eslint_fix() {
    echo "🔄 Iteration $((ITERATION + 1)): Running eslint --fix..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Run eslint --fix and show output
    npx eslint . --fix --format=stylish
    
    return $?
}

# Initial check
INITIAL_ISSUES=$(count_eslint_issues)
echo "📋 Initial ESLint issues found: $INITIAL_ISSUES"
echo ""

if [ "$INITIAL_ISSUES" -eq 0 ]; then
    echo "✅ No ESLint issues found! Nothing to fix."
    exit 0
fi

# Track previous issue count to detect no progress
PREVIOUS_ISSUES=$INITIAL_ISSUES

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ]; do
    ITERATION=$((ITERATION + 1))
    
    # Run eslint --fix
    run_eslint_fix
    FIX_EXIT_CODE=$?
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Count remaining issues
    REMAINING_ISSUES=$(count_eslint_issues)
    
    # Calculate progress
    FIXED_THIS_ITERATION=$((PREVIOUS_ISSUES - REMAINING_ISSUES))
    TOTAL_FIXED=$((INITIAL_ISSUES - REMAINING_ISSUES))
    
    # Calculate percentage
    if [ "$INITIAL_ISSUES" -gt 0 ]; then
        PROGRESS_PERCENT=$((TOTAL_FIXED * 100 / INITIAL_ISSUES))
    else
        PROGRESS_PERCENT=100
    fi
    
    # Show progress summary
    echo ""
    echo "📊 Progress Summary:"
    echo "   Iteration: $ITERATION/$MAX_ITERATIONS"
    echo "   Fixed this iteration: $FIXED_THIS_ITERATION"
    echo "   Total fixed: $TOTAL_FIXED / $INITIAL_ISSUES"
    echo "   Remaining: $REMAINING_ISSUES"
    echo "   Progress: $PROGRESS_PERCENT%"
    
    # Show progress bar
    BAR_LENGTH=50
    FILLED=$((PROGRESS_PERCENT * BAR_LENGTH / 100))
    EMPTY=$((BAR_LENGTH - FILLED))
    BAR=$(printf "%${FILLED}s" | tr ' ' '█')
    EMPTY_BAR=$(printf "%${EMPTY}s" | tr ' ' '░')
    echo "   [$BAR$EMPTY_BAR] $PROGRESS_PERCENT%"
    
    # Show files with remaining issues
    if [ "$REMAINING_ISSUES" -gt 0 ]; then
        get_issue_details
    fi
    
    echo ""
    
    # Check if all issues are fixed
    if [ "$REMAINING_ISSUES" -eq 0 ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "✅ All ESLint issues fixed!"
        echo "📈 Total iterations: $ITERATION"
        echo "🔧 Total issues fixed: $INITIAL_ISSUES"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 0
    fi
    
    # Check if no progress was made (same number of issues as previous iteration)
    if [ "$REMAINING_ISSUES" -eq "$PREVIOUS_ISSUES" ] && [ $ITERATION -gt 1 ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "⚠️  No progress made in this iteration. Some issues may require manual intervention."
        echo "📊 Remaining issues: $REMAINING_ISSUES"
        echo "💡 Run 'npx eslint .' to see details of remaining issues."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 1
    fi
    
    # Update previous issues count for next iteration
    PREVIOUS_ISSUES=$REMAINING_ISSUES
    
    # Small delay to make output readable
    sleep 0.3
done

# If we reach here, we hit max iterations
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  Reached maximum iterations ($MAX_ITERATIONS)"
echo "📊 Remaining issues: $REMAINING_ISSUES"
TOTAL_FIXED=$((INITIAL_ISSUES - REMAINING_ISSUES))
echo "🔧 Total issues fixed: $TOTAL_FIXED / $INITIAL_ISSUES"
echo "💡 Some issues may require manual intervention."
echo "💡 Run 'npx eslint .' to see details of remaining issues."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 1

