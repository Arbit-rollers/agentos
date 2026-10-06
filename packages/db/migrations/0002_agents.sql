CREATE TYPE "public"."agent_status" AS ENUM('draft', 'configured', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('master_orchestrator', 'manager', 'specialist', 'system');--> statement-breakpoint
CREATE TABLE "agent_personalities" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"preset" text NOT NULL,
	"trait_scores" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"parent_agent_id" uuid,
	"agent_type" "agent_type" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"avatar" text DEFAULT 'preset:bot' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"job_definition" text DEFAULT '' NOT NULL,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"constraints" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "agent_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_personalities" ADD CONSTRAINT "agent_personalities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_workspace_status_idx" ON "agents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "agents_parent_idx" ON "agents" USING btree ("parent_agent_id");