#!/bin/bash

# Test script for connection pool fixes
# This script helps verify that the connection pool fixes are working correctly

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Connection Pool Fixes Testing Script ===${NC}\n"

# Load environment variables from .env file if it exists
# Note: This script should only be run in development/staging environments
if [ -f .env ]; then
    echo -e "${GREEN}Loading environment variables from .env file...${NC}"
    # Use a safer method to load env vars that handles special characters
    # Only load lines that look like KEY=VALUE (no comments, no special shell chars)
    while IFS='=' read -r key value || [ -n "$key" ]; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        # Remove quotes from value if present
        value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
        # Only export if it looks like a valid env var (starts with letter/underscore)
        if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            export "$key=$value" 2>/dev/null || true
        fi
    done < .env
fi

# Also try .env.local if it exists
if [ -f .env.local ]; then
    echo -e "${GREEN}Loading environment variables from .env.local file...${NC}"
    while IFS='=' read -r key value || [ -n "$key" ]; do
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
        if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            export "$key=$value" 2>/dev/null || true
        fi
    done < .env.local
fi

# Security warning for production (skip for localhost connections)
# Only warn if it's clearly a remote production database
if echo "$DATABASE_URL" | grep -qE "localhost|127\.0\.0\.1|192\.168\.|10\.|172\."; then
    # Localhost connection - safe to proceed
    echo -e "${GREEN}Local database detected - safe to proceed${NC}"
elif [ "$NODE_ENV" = "production" ] || echo "$DATABASE_URL" | grep -qE "production|prod\.|\.prod\.|\.rds\.|\.amazonaws\.|supabase\.co"; then
    # Remote production-like database - show warning
    echo -e "${RED}⚠️  WARNING: This appears to be a remote/production database!${NC}"
    echo -e "${YELLOW}Consider using a read-only database user for testing.${NC}"
    echo -e "${YELLOW}Database URL detected: ${MASKED_URL}${NC}"
    read -p "Continue anyway? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Aborted for safety."
        exit 1
    fi
fi

# Check if DATABASE_URL is set, fallback to POSTGRES_PRISMA_URL or POSTGRES_URL
if [ -z "$DATABASE_URL" ]; then
    if [ -n "$POSTGRES_PRISMA_URL" ]; then
        echo -e "${YELLOW}DATABASE_URL not set, using POSTGRES_PRISMA_URL${NC}"
        export DATABASE_URL="$POSTGRES_PRISMA_URL"
    elif [ -n "$POSTGRES_URL" ]; then
        echo -e "${YELLOW}DATABASE_URL not set, using POSTGRES_URL${NC}"
        export DATABASE_URL="$POSTGRES_URL"
    else
        echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
        echo "Please set DATABASE_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL in .env file"
        exit 1
    fi
fi

# Extract database connection info (masked for security)
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

# Mask sensitive parts of URL for display
MASKED_URL=$(echo $DATABASE_URL | sed 's/:\/\/[^@]*@/:\/\/***:***@/')

echo -e "${GREEN}Database Configuration:${NC}"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo "  URL: $MASKED_URL"
echo ""
echo -e "${YELLOW}Note: Sensitive credentials are masked in output${NC}"
echo ""

# Function to check connection pool status
check_connection_pool() {
    echo -e "${BLUE}Checking connection pool status...${NC}"
    
    psql "$DATABASE_URL" -c "
        SELECT 
            application_name,
            state,
            count(*) AS connections,
            max(now() - state_change) AS oldest_connection
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY application_name, state
        ORDER BY connections DESC;
    " 2>/dev/null || echo -e "${YELLOW}Warning: Could not query database. Make sure psql is installed and DATABASE_URL is correct.${NC}"
}

# Function to check active connections
check_active_connections() {
    echo -e "${BLUE}Checking active connections...${NC}"
    
    psql "$DATABASE_URL" -c "
        SELECT 
            count(*) AS total_connections,
            count(*) FILTER (WHERE state = 'active') AS active_connections,
            count(*) FILTER (WHERE state = 'idle') AS idle_connections,
            count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction
        FROM pg_stat_activity
        WHERE datname = current_database();
    " 2>/dev/null || echo -e "${YELLOW}Warning: Could not query database.${NC}"
}

# Function to check for connection leaks
check_connection_leaks() {
    echo -e "${BLUE}Checking for connection leaks (connections active > 5 minutes)...${NC}"
    
    psql "$DATABASE_URL" -c "
        SELECT 
            pid,
            usename,
            application_name,
            state,
            now() - state_change AS connection_age,
            LEFT(query, 50) AS query_preview
        FROM pg_stat_activity
        WHERE datname = current_database()
            AND state = 'active'
            AND now() - state_change > interval '5 minutes'
        ORDER BY connection_age DESC;
    " 2>/dev/null || echo -e "${YELLOW}Warning: Could not query database.${NC}"
}

# Function to check max connections setting
check_max_connections() {
    echo -e "${BLUE}Checking max connections setting...${NC}"
    
    psql "$DATABASE_URL" -c "
        SELECT 
            name,
            setting,
            unit,
            source
        FROM pg_settings
        WHERE name = 'max_connections';
    " 2>/dev/null || echo -e "${YELLOW}Warning: Could not query database.${NC}"
}

# Main menu
echo -e "${GREEN}Select an option:${NC}"
echo "1. Check connection pool status"
echo "2. Check active connections"
echo "3. Check for connection leaks"
echo "4. Check max connections setting"
echo "5. Run all checks"
echo "6. Monitor connections in real-time (every 5 seconds)"
echo ""

read -p "Enter option (1-6): " option

case $option in
    1)
        check_connection_pool
        ;;
    2)
        check_active_connections
        ;;
    3)
        check_connection_leaks
        ;;
    4)
        check_max_connections
        ;;
    5)
        check_max_connections
        echo ""
        check_connection_pool
        echo ""
        check_active_connections
        echo ""
        check_connection_leaks
        ;;
    6)
        echo -e "${GREEN}Monitoring connections (Press Ctrl+C to stop)...${NC}\n"
        while true; do
            clear
            echo -e "${BLUE}=== Connection Pool Status (Updated: $(date +%H:%M:%S)) ===${NC}\n"
            check_active_connections
            echo ""
            check_connection_pool
            sleep 5
        done
        ;;
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac

echo -e "\n${GREEN}Done!${NC}"
