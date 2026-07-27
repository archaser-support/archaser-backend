#!/bin/bash

# LogActivity Test Runner Script
# Usage: ./scripts/test-log-activity.sh [options]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
TEST_FILE="log-activity.spec.ts"
BROWSER="chromium"
HEADLESS="false"
UI_MODE="false"
DEBUG_MODE="false"
CONFIG_FILE="test/log-activity.config.ts"

# Function to print usage
print_usage() {
    echo -e "${BLUE}LogActivity Test Runner${NC}"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -f, --file FILE        Test file to run (default: log-activity.spec.ts)"
    echo "  -b, --browser BROWSER  Browser to use (chromium, firefox, webkit) (default: chromium)"
    echo "  -h, --headless         Run in headless mode"
    echo "  -u, --ui               Run in UI mode"
    echo "  -d, --debug            Run in debug mode"
    echo "  -c, --config FILE      Config file to use (default: test/log-activity.config.ts)"
    echo "  --help                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Run default tests"
    echo "  $0 -f log-activity-simplified.spec.ts # Run simplified tests"
    echo "  $0 -b firefox                         # Run in Firefox"
    echo "  $0 -u                                 # Run in UI mode"
    echo "  $0 -d                                 # Run in debug mode"
    echo "  $0 -h                                 # Run in headless mode"
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}Checking prerequisites...${NC}"
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js is not installed${NC}"
        exit 1
    fi
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}Error: npm is not installed${NC}"
        exit 1
    fi
    
    # Check if .env.test exists
    if [ ! -f ".env.test" ]; then
        echo -e "${YELLOW}Warning: .env.test file not found${NC}"
        echo -e "${YELLOW}Please create .env.test with E2E_EMAIL and E2E_PASSWORD${NC}"
    fi
    
    # Check if test file exists
    if [ ! -f "test/${TEST_FILE}" ]; then
        echo -e "${RED}Error: Test file test/${TEST_FILE} not found${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Prerequisites check passed${NC}"
}

# Function to install dependencies
install_dependencies() {
    echo -e "${BLUE}Installing dependencies...${NC}"
    
    # Install npm dependencies
    npm install
    
    # Install Playwright browsers
    npx playwright install --with-deps
    
    echo -e "${GREEN}Dependencies installed${NC}"
}

# Function to setup authentication
setup_auth() {
    echo -e "${BLUE}Setting up authentication...${NC}"
    
    # Run global setup to create auth state
    npm run test:auth
    
    echo -e "${GREEN}Authentication setup complete${NC}"
}

# Function to run tests
run_tests() {
    echo -e "${BLUE}Running LogActivity tests...${NC}"
    echo -e "Test file: ${YELLOW}${TEST_FILE}${NC}"
    echo -e "Browser: ${YELLOW}${BROWSER}${NC}"
    echo -e "Headless: ${YELLOW}${HEADLESS}${NC}"
    echo -e "UI mode: ${YELLOW}${UI_MODE}${NC}"
    echo -e "Debug mode: ${YELLOW}${DEBUG_MODE}${NC}"
    echo ""
    
    # Build the command
    CMD="npx playwright test"
    
    if [ "$UI_MODE" = "true" ]; then
        CMD="$CMD --ui"
    elif [ "$DEBUG_MODE" = "true" ]; then
        CMD="$CMD --debug"
    else
        CMD="$CMD --config=${CONFIG_FILE}"
        
        if [ "$HEADLESS" = "true" ]; then
            CMD="$CMD --headed=false"
        fi
        
        if [ "$BROWSER" != "chromium" ]; then
            CMD="$CMD --project=log-activity-${BROWSER}"
        fi
    fi
    
    CMD="$CMD test/${TEST_FILE}"
    
    echo -e "${BLUE}Executing: ${YELLOW}${CMD}${NC}"
    echo ""
    
    # Execute the command
    eval $CMD
}

# Function to show test results
show_results() {
    echo ""
    echo -e "${BLUE}Test Results:${NC}"
    
    if [ -d "playwright-report-log-activity" ]; then
        echo -e "${GREEN}HTML report available at: playwright-report-log-activity/index.html${NC}"
        echo -e "Run: ${YELLOW}npx playwright show-report playwright-report-log-activity${NC}"
    fi
    
    if [ -f "test-results-log-activity.json" ]; then
        echo -e "${GREEN}JSON results available at: test-results-log-activity.json${NC}"
    fi
    
    if [ -f "junit-log-activity.xml" ]; then
        echo -e "${GREEN}JUnit results available at: junit-log-activity.xml${NC}"
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--file)
            TEST_FILE="$2"
            shift 2
            ;;
        -b|--browser)
            BROWSER="$2"
            shift 2
            ;;
        -h|--headless)
            HEADLESS="true"
            shift
            ;;
        -u|--ui)
            UI_MODE="true"
            shift
            ;;
        -d|--debug)
            DEBUG_MODE="true"
            shift
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --help)
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

# Validate browser option
if [[ ! "$BROWSER" =~ ^(chromium|firefox|webkit)$ ]]; then
    echo -e "${RED}Error: Invalid browser. Must be chromium, firefox, or webkit${NC}"
    exit 1
fi

# Main execution
echo -e "${GREEN}🚀 LogActivity Test Runner${NC}"
echo ""

check_prerequisites
install_dependencies
setup_auth
run_tests
show_results

echo ""
echo -e "${GREEN}✅ LogActivity tests completed!${NC}" 