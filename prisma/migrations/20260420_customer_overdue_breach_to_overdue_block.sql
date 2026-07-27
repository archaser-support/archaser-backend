-- Customer: overdue_block — rename legacy overdue_breach, or add if missing
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Customer'
      AND column_name = 'overdue_breach'
  ) THEN
    ALTER TABLE "Customer" RENAME COLUMN "overdue_breach" TO "overdue_block";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Customer'
      AND column_name = 'overdue_block'
  ) THEN
    ALTER TABLE "Customer" ADD COLUMN "overdue_block" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
