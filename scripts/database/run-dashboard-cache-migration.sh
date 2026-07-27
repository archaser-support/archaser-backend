#!/bin/bash

# Script to run the dashboard cache migration
# This script will execute the SQL migration file to add the DashboardCache table
#
# IMPORTANT: This migration creates a new table for caching dashboard data.
# Cache expiration is handled on read, and cache is invalidated immediately when data changes.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Running Dashboard Cache Migration${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "backend/prisma/schema.prisma" ]; then
    echo -e "${RED}❌ Error: backend/prisma/schema.prisma not found. Please run this script from the project root.${NC}"
    exit 1
fi

# Check if migration file exists
MIGRATION_FILE="prisma/migrations/add_dashboard_cache.sql"
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}❌ Error: Migration file not found at $MIGRATION_FILE${NC}"
    exit 1
fi

# Check if DATABASE_URL is already set in environment
if [ -z "$DATABASE_URL" ]; then
    # Try to extract DATABASE_URL from .env file if it exists
    if [ -f ".env" ]; then
        echo -e "${YELLOW}Extracting DATABASE_URL from .env file...${NC}"
        # Use grep and sed to safely extract DATABASE_URL (handles special characters)
        DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d '=' -f2- | sed 's/^"//' | sed 's/"$//' | sed "s/^'//" | sed "s/'$//")
        
        # If DATABASE_URL not found, try POSTGRES_PRISMA_URL
        if [ -z "$DATABASE_URL" ]; then
            DATABASE_URL=$(grep "^POSTGRES_PRISMA_URL=" .env | cut -d '=' -f2- | sed 's/^"//' | sed 's/"$//' | sed "s/^'//" | sed "s/'$//")
        fi
        
        # If still not found, try POSTGRES_URL
        if [ -z "$DATABASE_URL" ]; then
            DATABASE_URL=$(grep "^POSTGRES_URL=" .env | cut -d '=' -f2- | sed 's/^"//' | sed 's/"$//' | sed "s/^'//" | sed "s/'$//")
        fi
    fi
    
    # Check if we found DATABASE_URL
    if [ -z "$DATABASE_URL" ]; then
        echo -e "${RED}❌ Error: DATABASE_URL environment variable is not set${NC}"
        echo "Please set DATABASE_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL in .env file"
        echo "Or export it manually: export DATABASE_URL='your_database_url'"
        exit 1
    fi
    
    export DATABASE_URL
fi

# Mask sensitive parts of URL for display
MASKED_URL=$(echo $DATABASE_URL | sed 's/:\/\/[^@]*@/:\/\/***:***@/')
echo -e "${GREEN}Database: ${MASKED_URL}${NC}"
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ Error: psql command not found${NC}"
    echo "Please install PostgreSQL client tools:"
    echo "  macOS: brew install postgresql"
    echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
    echo "  Or use the TypeScript migration runner instead"
    exit 1
fi

# Parse DATABASE_URL and remove query parameters for psql
# psql doesn't support query parameters in connection strings
CLEAN_DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/?.*$//')

# Run the migration
echo -e "${YELLOW}Executing migration: $MIGRATION_FILE${NC}"
echo ""

if psql "$CLEAN_DATABASE_URL" -f "$MIGRATION_FILE"; then
    echo ""
    echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    echo ""
    echo -e "${YELLOW}Next step: Generate Prisma client${NC}"
    echo "Run: npx prisma generate"
else
    echo ""
    echo -e "${RED}❌ Migration failed${NC}"
    exit 1
fi

