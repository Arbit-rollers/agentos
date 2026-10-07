CREATE TYPE "public"."mcp_credential_mode" AS ENUM('shared', 'per_user');--> statement-breakpoint
CREATE TABLE "mcp_user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_id" uuid,
	"status" text DEFAULT 'needs_auth' NOT NULL,
	"oauth_state_hash" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "credential_mode" "mcp_credential_mode" DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "oauth_scopes" text;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "oauth_params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_user_credentials" ADD CONSTRAINT "mcp_user_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_credentials" ADD CONSTRAINT "mcp_user_credentials_connection_id_mcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_credentials" ADD CONSTRAINT "mcp_user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_credentials" ADD CONSTRAINT "mcp_user_credentials_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_user_credentials_key" ON "mcp_user_credentials" USING btree ("connection_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_user_credentials_state_key" ON "mcp_user_credentials" USING btree ("oauth_state_hash");