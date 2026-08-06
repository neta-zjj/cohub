ALTER TABLE "v2"."canvas_checkpoint_snapshots" RENAME TO "board_checkpoint_snapshots";--> statement-breakpoint
ALTER TABLE "v2"."canvas_documents" RENAME TO "board_documents";--> statement-breakpoint
ALTER TABLE "v2"."canvas_nodes" RENAME TO "board_nodes";--> statement-breakpoint
ALTER TABLE "v2"."canvas_updates" RENAME TO "board_updates";--> statement-breakpoint
DROP INDEX "v2"."v2_uq_canvas_checkpoint_snapshots_path";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_canvas_checkpoint_snapshots_checkpoint_id";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_canvas_documents_space_id";--> statement-breakpoint
DROP INDEX "v2"."v2_uq_canvas_documents_space_path";--> statement-breakpoint
DROP INDEX "v2"."v2_uq_canvas_nodes_document_node";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_canvas_nodes_document_id";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_canvas_nodes_viewport";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_canvas_nodes_ref_path";--> statement-breakpoint
DROP INDEX "v2"."v2_uq_canvas_updates_document_version";--> statement-breakpoint
DROP INDEX "v2"."v2_idx_canvas_updates_document_id";--> statement-breakpoint
DROP INDEX "v2"."v2_uq_canvas_updates_document_tx";--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_checkpoint_snapshots_path" ON "v2"."board_checkpoint_snapshots" USING btree ("checkpoint_id","source_file_path");--> statement-breakpoint
CREATE INDEX "v2_idx_board_checkpoint_snapshots_checkpoint_id" ON "v2"."board_checkpoint_snapshots" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_documents_space_id" ON "v2"."board_documents" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_documents_space_path" ON "v2"."board_documents" USING btree ("space_id","file_path");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_nodes_document_node" ON "v2"."board_nodes" USING btree ("document_id","node_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_nodes_document_id" ON "v2"."board_nodes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "v2_idx_board_nodes_viewport" ON "v2"."board_nodes" USING btree ("document_id","x","y","width","height");--> statement-breakpoint
CREATE INDEX "v2_idx_board_nodes_ref_path" ON "v2"."board_nodes" USING btree ("document_id","ref_path");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_updates_document_version" ON "v2"."board_updates" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "v2_idx_board_updates_document_id" ON "v2"."board_updates" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_board_updates_document_tx" ON "v2"."board_updates" USING btree ("document_id","tx_id") WHERE "v2"."board_updates"."tx_id" is not null;
