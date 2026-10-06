CREATE TYPE "public"."mcp_auth_type" AS ENUM('none', 'bearer', 'headers', 'oauth');--> statement-breakpoint
CREATE TYPE "public"."mcp_status" AS ENUM('connected', 'error', 'needs_auth', 'untested');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('streamable_http', 'sse');--> statement-breakpoint
CREATE TYPE "public"."permission_mode" AS ENUM('AUTO_ALLOW', 'APPROVAL_REQUIRED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "agent_tool_permissions" (
	"agent_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"permission_mode" "permission_mode" NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tool_permissions_agent_id_tool_id_pk" PRIMARY KEY("agent_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"server_type" text DEFAULT 'custom' NOT NULL,
	"transport" "mcp_transport" NOT NULL,
	"endpoint" text NOT NULL,
	"auth_type" "mcp_auth_type" NOT NULL,
	"secret_id" uuid,
	"status" "mcp_status" DEFAULT 'untested' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"server_info" jsonb,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"oauth_state_hash" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"description" text DEFAULT '' NOT NULL,
	"input_schema" jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_category" text,
	"default_permission" "permission_mode" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_tool_id_mcp_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."mcp_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_connection_id_mcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tool_permissions_tool_idx" ON "agent_tool_permissions" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "mcp_connections_workspace_idx" ON "mcp_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_oauth_state_key" ON "mcp_connections" USING btree ("oauth_state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tools_connection_name_key" ON "mcp_tools" USING btree ("connection_id","name");