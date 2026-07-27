#!/bin/bash

echo "🔍 Watching all unit tests and source files for changes..."
echo "📁 Monitoring: test/unit/, server/services/, utils/, components/, pages/api/"
echo "🧪 Tests will run automatically when files change"
echo ""

# Function to run specific test category
run_test_category() {
    local category=$1
    echo "🔄 Changes detected in $category, running tests..."
    
    case $category in
        "services")
            npm run test:unit -- test/unit/services/
            ;;
        "api")
            npm run test:unit -- test/unit/api/
            ;;
        "components")
            npm run test:unit -- test/unit/components/
            ;;
        "utils")
            npm run test:unit -- test/unit/utils/
            ;;
        "portal")
            npm run test:portal
            ;;
        "business-logic")
            npm run test:business-logic
            ;;
        "styled-datagrid")
            npm run test:styled-datagrid
            ;;
        "logout")
            npm run test:logout
            ;;
        "account-creation")
            npm run test:account-creation
            ;;
        *)
            echo "⚠️  Unknown category: $category"
            return 1
            ;;
    esac
    
    if [ $? -eq 0 ]; then
        echo "✅ $category tests passed!"
    else
        echo "❌ Some $category tests failed!"
    fi
    echo ""
}

# Function to determine test category from file path
get_test_category() {
    local file_path=$1
    
    # Business logic files
    if [[ $file_path == *"businessHoursService"* ]] || [[ $file_path == *"holidayCalendarService"* ]] || [[ $file_path == *"datetimeOperations"* ]]; then
        echo "business-logic"
        return
    fi
    
    # Portal files
    if [[ $file_path == *"portal"* ]]; then
        echo "portal"
        return
    fi
    
    # StyledDataGrid component
    if [[ $file_path == *"StyledDataGrid"* ]]; then
        echo "styled-datagrid"
        return
    fi
    
    # Logout utilities
    if [[ $file_path == *"logoutUtils"* ]]; then
        echo "logout"
        return
    fi
    
    # Account creation
    if [[ $file_path == *"CustomerService"* ]] || [[ $file_path == *"account-creation"* ]]; then
        echo "account-creation"
        return
    fi
    
    # Services
    if [[ $file_path == *"server/services"* ]] || [[ $file_path == *"test/unit/services"* ]]; then
        echo "services"
        return
    fi
    
    # API endpoints
    if [[ $file_path == *"pages/api"* ]] || [[ $file_path == *"test/unit/api"* ]]; then
        echo "api"
        return
    fi
    
    # Components
    if [[ $file_path == *"components"* ]] || [[ $file_path == *"test/unit/components"* ]] || [[ $file_path == *"app/[locale]/app"* ]]; then
        echo "components"
        return
    fi
    
    # Utils
    if [[ $file_path == *"utils"* ]] || [[ $file_path == *"test/unit/utils"* ]]; then
        echo "utils"
        return
    fi
    
    # Default to services if unknown
    echo "services"
}

# Watch for changes in all relevant directories and files
echo "📡 Starting file watcher..."

fswatch -o \
    utils/ \
    server/services/ \
    pages/api/ \
    components/ \
    app/[locale]/app/ \
    app/[locale]/portal/ \
    pages/api/portal/ \
    test/unit/ | while read f; do
    
    # Get the category for the changed file
    category=$(get_test_category "$f")
    
    # Run the appropriate tests
    run_test_category "$category"
done 