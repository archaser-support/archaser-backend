#!/bin/bash

# Script to run eslint --fix and check TypeScript errors in a loop
# Usage: ./scripts/fix-all-errors.sh [max_iterations]

MAX_ITERATIONS=${1:-50}
ITERATION=0

echo "🔧 Starting combined ESLint and TypeScript error fixing..."
echo "📊 Max iterations: $MAX_ITERATIONS"
echo ""

# Function to count ESLint errors and warnings (all issues)
count_eslint_issues() {
    # Use compact format for reliable counting
    # Capture output and exit code correctly
    local output
    local exit_code
    output=$(npx eslint . --format=compact 2>&1)
    exit_code=$?
    
    # If eslint exits with 0, there are no issues
    if [ $exit_code -eq 0 ]; then
        echo "0"
        return 0
    fi
    
    # Count lines that contain "error" or "warning" (case-insensitive)
    # Filter out lines that are just summary lines (like "✖ X problems")
    local count=$(echo "$output" | grep -iE "(error|warning)" | grep -vE "^(✖|✔|Problems|problems)" | wc -l | tr -d ' ')
    echo "${count:-0}"
}

# Function to count only fixable ESLint issues
count_fixable_eslint_issues() {
    # Use JSON format to get fixable counts
    local output
    local exit_code
    output=$(npx eslint . --format=json 2>/dev/null)
    exit_code=$?
    
    # If eslint exits with 0, there are no issues
    if [ $exit_code -eq 0 ]; then
        echo "0"
        return 0
    fi
    
    # Parse JSON to count fixable issues
    if command -v node &> /dev/null; then
        local count=$(echo "$output" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
                const total = Array.isArray(data) 
                    ? data.reduce((sum, file) => sum + (file.fixableErrorCount || 0) + (file.fixableWarningCount || 0), 0)
                    : 0;
                console.log(total);
            } catch (e) {
                console.log('0');
            }
        " 2>/dev/null)
        echo "${count:-0}"
    else
        # Fallback: use --fix-dry-run to see what would be fixed
        local dry_run_output=$(npx eslint . --fix-dry-run --format=compact 2>&1)
        local before_count=$(count_eslint_issues)
        # This is approximate - we'd need to actually run fix to know
        echo "0"
    fi
}

# Function to count TypeScript errors
count_typescript_errors() {
    # Run TypeScript compiler and capture errors
    # Use a different approach to capture both output and exit code
    local output
    local exit_code
    output=$(npx tsc --noEmit 2>&1)
    exit_code=$?
    
    # If TypeScript exits with 0, there are no errors
    if [ $exit_code -eq 0 ]; then
        echo "0"
        return 0
    fi
    
    # Count error lines (lines that contain "error TS")
    local count=$(echo "$output" | grep -cE "error TS" || echo "0")
    echo "${count:-0}"
}

# Function to get ESLint issue details
get_eslint_details() {
    local output=$(npx eslint . --format=json 2>/dev/null)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        return 0
    fi
    
    if command -v node &> /dev/null; then
        echo "$output" | node -e "
            try {
                const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
                if (Array.isArray(data)) {
                    const filesWithIssues = data.filter(f => (f.errorCount || 0) + (f.warningCount || 0) > 0);
                    if (filesWithIssues.length > 0) {
                        console.log('📁 ESLint - Files with issues:');
                        filesWithIssues.slice(0, 5).forEach(file => {
                            const total = (file.errorCount || 0) + (file.warningCount || 0);
                            console.log(\`   - \${file.filePath}: \${total} issue(s)\`);
                        });
                        if (filesWithIssues.length > 5) {
                            console.log(\`   ... and \${filesWithIssues.length - 5} more file(s)\`);
                        }
                    }
                }
            } catch (e) {
                // Ignore parsing errors
            }
        " 2>/dev/null
    fi
}

# Function to get TypeScript error details
get_typescript_details() {
    local output=$(npx tsc --noEmit 2>&1)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        return 0
    fi
    
    # Show first 5 TypeScript errors
    echo "$output" | grep -E "error TS" | head -5 | while IFS= read -r line; do
        echo "   - $line"
    done
    
    local total=$(echo "$output" | grep -cE "error TS" || echo "0")
    if [ "$total" -gt 5 ]; then
        echo "   ... and $((total - 5)) more error(s)"
    fi
}

# Function to run eslint --fix
run_eslint_fix() {
    echo "🔄 Running ESLint --fix..."
    npx eslint . --fix --format=stylish 2>&1 | head -30
    return $?
}

# Function to check TypeScript (read-only, no fixing)
check_typescript() {
    echo "🔍 Checking TypeScript errors..."
    npx tsc --noEmit 2>&1 | head -20
    return $?
}

# Initial checks
echo "📋 Initial checks..."
INITIAL_ESLINT_ISSUES=$(count_eslint_issues)
INITIAL_FIXABLE_ESLINT=$(count_fixable_eslint_issues)
INITIAL_TS_ERRORS=$(count_typescript_errors)

echo "   ESLint issues (total): $INITIAL_ESLINT_ISSUES"
echo "   ESLint issues (fixable): $INITIAL_FIXABLE_ESLINT"
echo "   TypeScript errors: $INITIAL_TS_ERRORS"
echo ""

if [ "$INITIAL_FIXABLE_ESLINT" -eq 0 ] && [ "$INITIAL_TS_ERRORS" -eq 0 ]; then
    if [ "$INITIAL_ESLINT_ISSUES" -gt 0 ]; then
        echo "⚠️  Found $INITIAL_ESLINT_ISSUES ESLint issues, but none are auto-fixable."
        echo "💡 These issues require manual intervention."
        echo "💡 Run 'npx eslint .' to see details."
    else
        echo "✅ No issues found! Nothing to fix."
    fi
    exit 0
fi

# If there are TypeScript errors, output "fix errors" message
# This signal can be detected by AI assistants to automatically fix errors
if [ "$INITIAL_TS_ERRORS" -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔴 TypeScript errors detected: $INITIAL_TS_ERRORS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo ">>> AUTO_FIX_TRIGGER: fix errors <<<"
    echo ""
fi

# Track previous counts (use fixable count for ESLint)
PREVIOUS_ESLINT_ISSUES=$INITIAL_FIXABLE_ESLINT
PREVIOUS_TS_ERRORS=$INITIAL_TS_ERRORS

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ]; do
    ITERATION=$((ITERATION + 1))
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔄 Iteration $ITERATION/$MAX_ITERATIONS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Step 1: Run ESLint --fix
    if [ "$INITIAL_FIXABLE_ESLINT" -gt 0 ]; then
        run_eslint_fix
        echo ""
    fi
    
    # Step 2: Check TypeScript errors
    if [ "$INITIAL_TS_ERRORS" -gt 0 ]; then
        check_typescript
        echo ""
    fi
    
    # Count remaining issues (use fixable count for ESLint)
    REMAINING_ESLINT=$(count_fixable_eslint_issues)
    REMAINING_ESLINT_TOTAL=$(count_eslint_issues)
    REMAINING_TS=$(count_typescript_errors)
    
    # Calculate progress
    ESLINT_FIXED_THIS_ITERATION=$((PREVIOUS_ESLINT_ISSUES - REMAINING_ESLINT))
    TS_FIXED_THIS_ITERATION=$((PREVIOUS_TS_ERRORS - REMAINING_TS))
    
    TOTAL_ESLINT_FIXED=$((INITIAL_FIXABLE_ESLINT - REMAINING_ESLINT))
    TOTAL_TS_FIXED=$((INITIAL_TS_ERRORS - REMAINING_TS))
    
    # Calculate percentages (use fixable count for progress)
    if [ "$INITIAL_FIXABLE_ESLINT" -gt 0 ]; then
        ESLINT_PROGRESS=$((TOTAL_ESLINT_FIXED * 100 / INITIAL_FIXABLE_ESLINT))
    else
        ESLINT_PROGRESS=100
    fi
    
    if [ "$INITIAL_TS_ERRORS" -gt 0 ]; then
        TS_PROGRESS=$((TOTAL_TS_FIXED * 100 / INITIAL_TS_ERRORS))
    else
        TS_PROGRESS=100
    fi
    
    # Show progress summary
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 Progress Summary:"
    echo ""
    
    # ESLint progress
    if [ "$INITIAL_FIXABLE_ESLINT" -gt 0 ]; then
        echo "📝 ESLint (fixable issues):"
        echo "   Fixed this iteration: $ESLINT_FIXED_THIS_ITERATION"
        echo "   Total fixed: $TOTAL_ESLINT_FIXED / $INITIAL_FIXABLE_ESLINT"
        echo "   Remaining fixable: $REMAINING_ESLINT"
        echo "   Total issues (including non-fixable): $REMAINING_ESLINT_TOTAL"
        echo "   Progress: $ESLINT_PROGRESS%"
        
        BAR_LENGTH=30
        FILLED=$((ESLINT_PROGRESS * BAR_LENGTH / 100))
        EMPTY=$((BAR_LENGTH - FILLED))
        BAR=$(printf "%${FILLED}s" | tr ' ' '█')
        EMPTY_BAR=$(printf "%${EMPTY}s" | tr ' ' '░')
        echo "   [$BAR$EMPTY_BAR] $ESLINT_PROGRESS%"
        
        if [ "$REMAINING_ESLINT" -gt 0 ]; then
            get_eslint_details
        fi
        echo ""
    fi
    
    # TypeScript progress
    if [ "$INITIAL_TS_ERRORS" -gt 0 ]; then
        echo "🔷 TypeScript:"
        echo "   Fixed this iteration: $TS_FIXED_THIS_ITERATION"
        echo "   Total fixed: $TOTAL_TS_FIXED / $INITIAL_TS_ERRORS"
        echo "   Remaining: $REMAINING_TS"
        echo "   Progress: $TS_PROGRESS%"
        
        BAR_LENGTH=30
        FILLED=$((TS_PROGRESS * BAR_LENGTH / 100))
        EMPTY=$((BAR_LENGTH - FILLED))
        BAR=$(printf "%${FILLED}s" | tr ' ' '█')
        EMPTY_BAR=$(printf "%${EMPTY}s" | tr ' ' '░')
        echo "   [$BAR$EMPTY_BAR] $TS_PROGRESS%"
        
        if [ "$REMAINING_TS" -gt 0 ]; then
            echo "   TypeScript errors:"
            get_typescript_details
        fi
        echo ""
    fi
    
    # Check if all fixable issues are fixed
    if [ "$REMAINING_ESLINT" -eq 0 ] && [ "$REMAINING_TS" -eq 0 ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "✅ All fixable issues fixed!"
        echo "📈 Total iterations: $ITERATION"
        echo "🔧 ESLint issues fixed: $INITIAL_FIXABLE_ESLINT"
        if [ "$REMAINING_ESLINT_TOTAL" -gt 0 ]; then
            echo "⚠️  Note: $REMAINING_ESLINT_TOTAL non-fixable ESLint issues remain (require manual fixes)"
        fi
        echo "🔧 TypeScript errors fixed: $INITIAL_TS_ERRORS"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 0
    fi
    
    # If there are still TypeScript errors, output "fix errors" message
    # This signal can be detected by AI assistants to automatically fix errors
    if [ "$REMAINING_TS" -gt 0 ]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🔴 TypeScript errors remaining: $REMAINING_TS"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo ">>> AUTO_FIX_TRIGGER: fix errors <<<"
        echo ""
    fi
    
    # Check if no progress was made
    NO_PROGRESS=true
    if [ "$REMAINING_ESLINT" -ne "$PREVIOUS_ESLINT_ISSUES" ]; then
        NO_PROGRESS=false
    fi
    if [ "$REMAINING_TS" -ne "$PREVIOUS_TS_ERRORS" ]; then
        NO_PROGRESS=false
    fi
    
    if [ "$NO_PROGRESS" = true ] && [ $ITERATION -gt 1 ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "⚠️  No progress made in this iteration."
        echo "📊 Remaining ESLint issues: $REMAINING_ESLINT"
        echo "📊 Remaining TypeScript errors: $REMAINING_TS"
        echo "💡 Some issues may require manual intervention."
        echo "💡 Run 'npx eslint .' and 'npx tsc --noEmit' to see details."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        # If there are TypeScript errors, output "fix errors" message
        # This signal can be detected by AI assistants to automatically fix errors
        if [ "$REMAINING_TS" -gt 0 ]; then
            echo ""
            echo ">>> AUTO_FIX_TRIGGER: fix errors <<<"
            echo ""
        fi
        
        exit 1
    fi
    
    # Update previous counts (use fixable count for ESLint)
    PREVIOUS_ESLINT_ISSUES=$REMAINING_ESLINT
    PREVIOUS_TS_ERRORS=$REMAINING_TS
    
    echo ""
    sleep 0.5
done

# If we reach here, we hit max iterations
REMAINING_ESLINT=$(count_fixable_eslint_issues)
REMAINING_ESLINT_TOTAL=$(count_eslint_issues)
REMAINING_TS=$(count_typescript_errors)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  Reached maximum iterations ($MAX_ITERATIONS)"
echo "📊 Remaining fixable ESLint issues: $REMAINING_ESLINT"
echo "📊 Remaining TypeScript errors: $REMAINING_TS"
TOTAL_ESLINT_FIXED=$((INITIAL_FIXABLE_ESLINT - REMAINING_ESLINT))
TOTAL_TS_FIXED=$((INITIAL_TS_ERRORS - REMAINING_TS))
echo "🔧 ESLint issues fixed: $TOTAL_ESLINT_FIXED / $INITIAL_FIXABLE_ESLINT"
if [ "$REMAINING_ESLINT_TOTAL" -gt 0 ]; then
    echo "⚠️  Note: $REMAINING_ESLINT_TOTAL non-fixable ESLint issues remain"
fi
echo "🔧 TypeScript errors fixed: $TOTAL_TS_FIXED / $INITIAL_TS_ERRORS"
echo "💡 Some issues may require manual intervention."
echo "💡 Run 'npx eslint .' and 'npx tsc --noEmit' to see details."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# If there are TypeScript errors, output "fix errors" message
# This signal can be detected by AI assistants to automatically fix errors
if [ "$REMAINING_TS" -gt 0 ]; then
    echo ""
    echo ">>> AUTO_FIX_TRIGGER: fix errors <<<"
    echo ""
fi

exit 1

