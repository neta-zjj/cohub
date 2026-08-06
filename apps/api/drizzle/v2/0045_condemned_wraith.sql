ALTER TABLE "v2"."canvas_updates" ADD COLUMN "tx_id" text;--> statement-breakpoint
-- Data migration (not expressible in schema): backfill from historical payload.
UPDATE "v2"."canvas_updates"
SET "tx_id" = payload->>'txId'
WHERE "tx_id" IS NULL AND payload ? 'txId';--> statement-breakpoint
-- If concurrent pre-index writes produced duplicate (document_id, txId) pairs,
-- keep the earliest row and null the rest so the unique index can be created.
WITH ranked AS (
	SELECT
		id,
		ROW_NUMBER() OVER (
			PARTITION BY document_id, tx_id
			ORDER BY version ASC, created_at ASC NULLS LAST, id ASC
		) AS rn
	FROM "v2"."canvas_updates"
	WHERE tx_id IS NOT NULL
)
UPDATE "v2"."canvas_updates" u
SET tx_id = NULL
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_canvas_updates_document_tx" ON "v2"."canvas_updates" USING btree ("document_id","tx_id") WHERE "v2"."canvas_updates"."tx_id" is not null;
