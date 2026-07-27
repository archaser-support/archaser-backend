#!/bin/bash

# Setup script for Business Units
# This script runs the SQL migration and then the data update script
#
# Usage:
#   ./scripts/setup-business-units.sh [--dry-run] [--account-id=10013]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    echo "Please set DATABASE_URL before running this script"
    exit 1
fi

# Extract database connection info from DATABASE_URL
# Format: postgresql://user:password@host:port/database
DB_URL="$DATABASE_URL"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Business Unit Setup Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Step 1: Run SQL migration
echo -e "${YELLOW}Step 1: Running SQL migration to create BusinessUnit table...${NC}"
echo ""

if command -v psql &> /dev/null; then
    # Extract database name from DATABASE_URL
    DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
    DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
    DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p' || echo "5432")
    DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
    
    echo "Connecting to database: $DB_NAME on $DB_HOST:$DB_PORT"
    
    # Run SQL migration
    psql "$DATABASE_URL" -f prisma/migrations/create_business_unit_table.sql
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ SQL migration completed successfully${NC}"
    else
        echo -e "${RED}✗ SQL migration failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Warning: psql command not found${NC}"
    echo "Please run the SQL migration manually:"
    echo "  psql -d your_database -f prisma/migrations/create_business_unit_table.sql"
    echo ""
    read -p "Press Enter to continue after running the SQL migration manually, or Ctrl+C to cancel..."
fi

echo ""

# Step 2: Run TypeScript data update script
echo -e "${YELLOW}Step 2: Running data update script...${NC}"
echo ""

# Pass all arguments to the TypeScript script
npx ts-node scripts/update-business-units-data.ts "$@"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ Business Unit setup completed successfully!${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}✗ Business Unit setup failed${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
fi

