ALTER TABLE "v2"."work_versions" ADD COLUMN "content_kind" varchar(20) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "v2"."work_versions" ADD COLUMN "artifact" jsonb;--> statement-breakpoint
ALTER TABLE "v2"."work_versions" ADD CONSTRAINT "v2_chk_work_versions_content_kind" CHECK ("v2"."work_versions"."content_kind" in ('web', 'file', 'board'));