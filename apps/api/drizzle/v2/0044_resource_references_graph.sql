-- resource_references is a rebuildable index (backfillable from source tables),
-- so we rebuild it cleanly for the graph-edge model: turn-sourced content edges,
-- agent_tool_file_* kinds, denormalized source ancestry, and no nulls in the
-- identity key.
DROP TABLE IF EXISTS "v2"."resource_references";
--> statement-breakpoint
CREATE TABLE "v2"."resource_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(30) NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" text NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" text NOT NULL,
	"source_space_id" uuid NOT NULL,
	"source_session_id" uuid,
	"count" integer DEFAULT 1 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "v2_uq_resource_references_identity" UNIQUE("kind","source_type","source_id","target_type","target_id")
);
--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_target" ON "v2"."resource_references" USING btree ("target_type","target_id","kind");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_source" ON "v2"."resource_references" USING btree ("source_type","source_id","kind");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_space_kind" ON "v2"."resource_references" USING btree ("source_space_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "v2_idx_resource_references_session_kind" ON "v2"."resource_references" USING btree ("source_session_id","kind");
