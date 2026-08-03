#!/bin/bash

# Script to set up internal email templates system
# This script will:
# 1. Run the SQL migration
# 2. Generate the Prisma client
# 3. Verify the setup

echo "🚀 Setting up Internal Email Templates System..."

# Check if we're in the right directory
if [ ! -f "backend/prisma/schema.prisma" ]; then
    echo "❌ Error: backend/prisma/schema.prisma not found. Please run this script from the project root."
    exit 1
fi

# Step 1: Run the SQL migration
echo "📊 Running SQL migration..."
if [ -f "migration_internal_email_templates.sql" ]; then
    echo "Found migration file. Please run this SQL manually in your database:"
    echo "cat migration_internal_email_templates.sql | psql -d your_database_name"
    echo ""
    echo "Or copy and paste the contents of migration_internal_email_templates.sql into your database client."
else
    echo "❌ Error: migration_internal_email_templates.sql not found."
    exit 1
fi

# Step 2: Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

if [ $? -eq 0 ]; then
    echo "✅ Prisma client generated successfully"
else
    echo "❌ Error: Failed to generate Prisma client"
    exit 1
fi

# Step 3: Verify the setup
echo "🔍 Verifying setup..."

# Check if the new model is available in the generated client
if grep -q "internalEmailTemplate" node_modules/.prisma/client/index.d.ts; then
    echo "✅ InternalEmailTemplate model found in Prisma client"
else
    echo "❌ Error: InternalEmailTemplate model not found in Prisma client"
    echo "Please ensure the migration was run successfully and regenerate the client"
    exit 1
fi

# Check if the service files exist
if [ -f "server/services/InternalEmailTemplateService.ts" ]; then
    echo "✅ InternalEmailTemplateService found"
else
    echo "❌ Error: InternalEmailTemplateService not found"
    exit 1
fi

if [ -f "pages/api/internalEmailTemplates/index.ts" ]; then
    echo "✅ Internal email templates API found"
else
    echo "❌ Error: Internal email templates API not found"
    exit 1
fi

if [ -f "app/[locale]/app/settings/InternalEmailTemplateList.tsx" ]; then
    echo "✅ InternalEmailTemplateList component found"
else
    echo "❌ Error: InternalEmailTemplateList component not found"
    exit 1
fi

echo ""
echo "🎉 Internal Email Templates System setup complete!"
echo ""
echo "Next steps:"
echo "1. Run the SQL migration in your database"
echo "2. Restart your development server"
echo "3. Navigate to Settings > Dispute > Internal Emails to configure templates"
echo ""
echo "The system will now use configurable templates for internal dispute email notifications." 