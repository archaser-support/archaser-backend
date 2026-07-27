-- Customer restore point: account flag and checkpoint storage.

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS "enable_customer_checkpoints" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CustomerCheckpoint" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saved_by" VARCHAR,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCheckpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerCheckpoint_customer_id_key" UNIQUE ("customer_id"),
    CONSTRAINT "CustomerCheckpoint_customer_id_fkey"
        FOREIGN KEY ("customer_id") REFERENCES "Customer"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "CustomerCheckpoint_account_id_fkey"
        FOREIGN KEY ("account_id") REFERENCES "Account"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_customer_checkpoint_account_id"
ON "CustomerCheckpoint" ("account_id");
