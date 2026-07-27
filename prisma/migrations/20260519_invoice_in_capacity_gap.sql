-- Invoice: flag open receivables allocated to capacity gap (FIFO by invoice_date)
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS in_capacity_gap BOOLEAN NOT NULL DEFAULT false;
