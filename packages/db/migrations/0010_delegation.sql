ALTER TYPE "public"."run_status" ADD VALUE 'waiting_agents' BEFORE 'completed';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");