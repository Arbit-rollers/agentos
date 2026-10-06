CREATE TYPE "public"."connection_status" AS ENUM('connected', 'error', 'untested');--> statement-breakpoint
CREATE TYPE "public"."model_strategy" AS ENUM('fixed', 'smart_router', 'fallback_chain');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('openai', 'anthropic', 'google', 'ollama', 'openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "model_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"strategy" "model_strategy" NOT NULL,
	"primary_connection_id" uuid NOT NULL,
	"primary_model" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_policy" jsonb DEFAULT '{"onExceed":"stop"}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_configs_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "model_fallbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_config_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"model" text NOT NULL,
	"priority" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_config_id" uuid NOT NULL,
	"task_category" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"model" text NOT NULL,
	"priority" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"name" text NOT NULL,
	"endpoint" text,
	"secret_id" uuid,
	"status" "connection_status" DEFAULT 'untested' NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid,
	"kind" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"strategy" "model_strategy",
	"task_category" text,
	"provider" "provider_kind",
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_primary_connection_id_provider_connections_id_fk" FOREIGN KEY ("primary_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_fallbacks" ADD CONSTRAINT "model_fallbacks_model_config_id_model_configs_id_fk" FOREIGN KEY ("model_config_id") REFERENCES "public"."model_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_fallbacks" ADD CONSTRAINT "model_fallbacks_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_model_config_id_model_configs_id_fk" FOREIGN KEY ("model_config_id") REFERENCES "public"."model_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_connections_workspace_idx" ON "provider_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_started_idx" ON "runs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_agent_started_idx" ON "runs" USING btree ("agent_id","started_at");