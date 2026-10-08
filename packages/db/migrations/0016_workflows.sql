CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_step_status" AS ENUM('running', 'waiting', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "workflow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"label" text NOT NULL,
	"status" "workflow_step_status" NOT NULL,
	"input" text,
	"output" text,
	"error" text,
	"task_id" uuid,
	"approval_id" uuid,
	"resume_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"triggered_by" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"input" text DEFAULT '' NOT NULL,
	"output" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "workflow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "workflow_step_id" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_version_id_workflow_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_steps_key" ON "workflow_run_steps" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE INDEX "workflow_run_steps_task_idx" ON "workflow_run_steps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "workflow_runs" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_key" ON "workflow_versions" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflows_workspace_idx" ON "workflows" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;