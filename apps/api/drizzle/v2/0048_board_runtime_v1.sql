DROP TABLE IF EXISTS "v2"."board_checkpoint_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "v2"."board_updates" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "v2"."board_nodes" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "v2"."board_documents" CASCADE;--> statement-breakpoint
CREATE TABLE "v2"."boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_nodes" (
	"board_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"type" varchar(40) NOT NULL,
	"parent_id" text,
	"order_key" text,
	"x" double precision DEFAULT 0 NOT NULL,
	"y" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 240 NOT NULL,
	"height" double precision DEFAULT 160 NOT NULL,
	"rotation" double precision DEFAULT 0 NOT NULL,
	"ref_kind" varchar(40),
	"ref_path" text,
	"ref_url" text,
	"view" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "v2"."board_effects" (
	"id" text NOT NULL,
	"board_id" uuid NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" text,
	"kind" varchar(160) NOT NULL,
	"kind_version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lifecycle" varchar(24) NOT NULL,
	"time_origin" varchar(24) NOT NULL,
	"layer" varchar(20) NOT NULL,
	"seed" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asset_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_sequences" (
	"id" text NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration" double precision NOT NULL,
	"seed" text NOT NULL,
	"rest_pose" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_clips" (
	"id" text NOT NULL,
	"board_id" uuid NOT NULL,
	"sequence_id" text NOT NULL,
	"kind" varchar(160) NOT NULL,
	"kind_version" integer NOT NULL,
	"target" jsonb NOT NULL,
	"start" double precision NOT NULL,
	"duration" double precision NOT NULL,
	"layer" varchar(20) NOT NULL,
	"fill" varchar(20) NOT NULL,
	"easing" varchar(80) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"keyframes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"tx_id" text NOT NULL,
	"base_version" integer NOT NULL,
	"result_version" integer NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"client_id" text,
	"undo_group_id" text,
	"operations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"operation_index" integer NOT NULL,
	"type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"inverse" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"source_board_id" uuid NOT NULL,
	"source_space_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "v2"."board_playback_states" (
	"board_id" uuid PRIMARY KEY NOT NULL,
	"playback_id" uuid NOT NULL,
	"sequence_id" text NOT NULL,
	"sequence_revision" integer NOT NULL,
	"playback_revision" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"position" double precision NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"time_scale" double precision NOT NULL,
	"seed" text NOT NULL,
	"command_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "v2"."board_nodes" ADD CONSTRAINT "board_nodes_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_effects" ADD CONSTRAINT "board_effects_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_sequences" ADD CONSTRAINT "board_sequences_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_clips" ADD CONSTRAINT "board_clips_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_transactions" ADD CONSTRAINT "board_transactions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_operations" ADD CONSTRAINT "board_operations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_operations" ADD CONSTRAINT "board_operations_transaction_id_board_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "v2"."board_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."board_playback_states" ADD CONSTRAINT "board_playback_states_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "v2"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "v2_idx_boards_space_id" ON "v2"."boards" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "v2_idx_boards_updated_at" ON "v2"."boards" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_nodes_board_node" ON "v2"."board_nodes" USING btree ("board_id","node_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_nodes_board_id" ON "v2"."board_nodes" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_nodes_viewport" ON "v2"."board_nodes" USING btree ("board_id","x","y","width","height");--> statement-breakpoint
CREATE INDEX "v2_idx_board_nodes_ref_path" ON "v2"."board_nodes" USING btree ("board_id","ref_path");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_effects_board_id" ON "v2"."board_effects" USING btree ("board_id","id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_effects_board_id" ON "v2"."board_effects" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_effects_target" ON "v2"."board_effects" USING btree ("board_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_sequences_board_id" ON "v2"."board_sequences" USING btree ("board_id","id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_sequences_board_id" ON "v2"."board_sequences" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_clips_sequence_id" ON "v2"."board_clips" USING btree ("board_id","sequence_id","id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_clips_timeline" ON "v2"."board_clips" USING btree ("board_id","sequence_id","start");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_transactions_board_tx" ON "v2"."board_transactions" USING btree ("board_id","tx_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_transactions_board_version" ON "v2"."board_transactions" USING btree ("board_id","result_version");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_operations_tx_order" ON "v2"."board_operations" USING btree ("transaction_id","operation_index");--> statement-breakpoint
CREATE INDEX "v2_idx_board_operations_board_id" ON "v2"."board_operations" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_checkpoints_board" ON "v2"."board_checkpoints" USING btree ("checkpoint_id","source_board_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_checkpoints_checkpoint_id" ON "v2"."board_checkpoints" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_playback_id" ON "v2"."board_playback_states" USING btree ("playback_id");
