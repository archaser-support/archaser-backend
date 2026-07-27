-- Add username field to User table
-- This migration adds a username column that will be used for authentication instead of email

-- Step 1: Add username column as nullable first
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);

-- Step 2: Populate username with email for existing users
UPDATE "User" SET "username" = "email" WHERE "username" IS NULL AND "email" IS NOT NULL;

-- Step 3: For users without email, use their id as username
UPDATE "User" SET "username" = "id" WHERE "username" IS NULL;

-- Step 4: Make username NOT NULL and add unique constraint
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- Step 5: Create unique index for username
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- Note: Email unique constraint is removed to allow same email in multiple accounts in future
-- The email column @unique attribute has been removed from schema.prisma
DROP INDEX IF EXISTS "User_email_key";
