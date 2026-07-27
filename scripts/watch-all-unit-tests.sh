#!/bin/bash

echo "🔍 Watching ALL unit tests and related files for changes..."
echo "📁 Monitoring: test/unit/, utils/, server/services/, components/, pages/api/"
echo "🧪 Tests will run automatically when files change"
echo ""

# Function to run tests based on file changes
run_tests_for_file() {
    local changed_file="$1"
    echo "🔄 Changes detected in: $changed_file"
    
    # Determine which tests to run based on the changed file
    case "$changed_file" in
        # Business Logic Tests (merged from watch-business-logic.sh)
        utils/businessHoursService.ts|types/BusinessHours.ts|test/unit/services/businessHoursService.test.ts)
            echo "🧪 Running business hours tests..."
            npm run test:business-hours
            ;;
        utils/holidayCalendarService.ts|test/unit/services/holidayCalendarService.test.ts)
            echo "🧪 Running holiday calendar tests..."
            npm run test:holiday-calendar
            ;;
        utils/datetimeOperations.ts|test/unit/utils/datetimeOperations.test.ts)
            echo "🧪 Running datetime operations tests..."
            npm run test:datetime-operations
            ;;
        # Business Logic Combined Test (original watch-business-logic.sh behavior)
        utils/businessHoursService.ts|utils/holidayCalendarService.ts|utils/datetimeOperations.ts|types/BusinessHours.ts|pages/api/contacts/|app/[locale]/app/customers/|test/unit/services/businessHoursService.test.ts|test/unit/services/holidayCalendarService.test.ts|test/unit/utils/datetimeOperations.test.ts)
            echo "🧪 Running all business logic tests..."
            npm run test:business-logic
            ;;
        
        # Service Tests
        server/services/CustomerService.ts)
            echo "🧪 Running customer service tests..."
            npm run test:services:business
            ;;
        server/services/ActivityService.ts)
            echo "🧪 Running activity service tests..."
            npm run test:services:activity
            ;;
        server/services/ImportService.ts)
            echo "🧪 Running import service tests..."
            npm run test:services:import
            ;;
        server/services/*.ts)
            echo "🧪 Running service tests..."
            npm run test:services:business
            ;;
        
        # API Tests
        pages/api/admin/*.ts)
            echo "🧪 Running admin API tests..."
            npm run test:api:admin
            ;;
        pages/api/business/*.ts)
            echo "🧪 Running business API tests..."
            npm run test:api:business
            ;;
        pages/api/*.ts)
            echo "🧪 Running API tests..."
            npm run test:api:admin
            ;;
        
        # Component Tests
        components/StyledDataGrid.tsx|shared/layout-components/grid/StyledDataGrid.tsx)
            echo "🧪 Running styled datagrid tests..."
            npm run test:styled-datagrid
            ;;
        app/[locale]/app/layout.tsx|utils/logoutUtils.ts)
            echo "🧪 Running logout tests..."
            npm run test:logout
            ;;
        app/[locale]/portal/**/*.tsx)
            echo "🧪 Running portal tests..."
            npm run test:portal
            ;;
        pages/api/portal/**/*.ts)
            echo "🧪 Running portal API tests..."
            npm run test:portal:api
            ;;
        
        # Utility Tests
        utils/logoUtils.ts)
            echo "🧪 Running logo utils tests..."
            npm run test:logo-utils
            ;;
        utils/validation/*.ts)
            echo "🧪 Running validation tests..."
            npm run test:utils:validation
            ;;
        utils/formatting/*.ts)
            echo "🧪 Running formatting tests..."
            npm run test:utils:formatting
            ;;
        utils/helpers/*.ts)
            echo "🧪 Running helpers tests..."
            npm run test:utils:helpers
            ;;
        
        # Test Files - run the specific test
        test/unit/services/CustomerService.test.ts)
            echo "🧪 Running customer service tests..."
            npm run test:services:business
            ;;
        test/unit/services/ActivityService.test.ts)
            echo "🧪 Running activity service tests..."
            npm run test:services:activity
            ;;
        test/unit/services/ImportService.test.ts)
            echo "🧪 Running import service tests..."
            npm run test:services:import
            ;;
        test/unit/components/StyledDataGrid.test.tsx)
            echo "🧪 Running styled datagrid tests..."
            npm run test:styled-datagrid
            ;;
        test/unit/utils/logoutUtils.test.ts)
            echo "🧪 Running logout tests..."
            npm run test:logout
            ;;
        test/unit/utils/logoUtils.test.ts)
            echo "🧪 Running logo utils tests..."
            npm run test:logo-utils
            ;;
        test/unit/portal/**/*.test.ts)
            echo "🧪 Running portal tests..."
            npm run test:portal
            ;;
        
        # Default - run all unit tests
        *)
            echo "🧪 Running all unit tests..."
            npm run test:unit
            ;;
    esac
    
    if [ $? -eq 0 ]; then
        echo "✅ Tests passed!"
    else
        echo "❌ Some tests failed!"
    fi
    echo ""
}

# Function to run tests
run_tests() {
    local changed_files="$1"
    
    # Split changed files and run tests for each
    while IFS= read -r -d '' file; do
        if [ -n "$file" ]; then
            run_tests_for_file "$file"
        fi
    done < <(printf '%s\0' "$changed_files")
}

# Watch for changes in all relevant files (merged from watch-business-logic.sh)
echo "📡 Starting file watcher..."
fswatch -o \
    utils/ \
    server/services/ \
    components/ \
    shared/layout-components/ \
    pages/api/ \
    pages/api/contacts/ \
    app/[locale]/app/ \
    app/[locale]/app/customers/ \
    app/[locale]/portal/ \
    types/ \
    test/unit/ | while read f; do
    run_tests "$f"
done 