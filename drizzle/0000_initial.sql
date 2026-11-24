CREATE TABLE "agent_catalogs" (
	"identity_id" text NOT NULL,
	"id" text NOT NULL,
	"url" text NOT NULL,
	"records" text NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "agent_catalogs_identity_id_id_pk" PRIMARY KEY("identity_id","id")
);
--> statement-breakpoint
CREATE TABLE "agent_config" (
	"identity_id" text NOT NULL,
	"namespace" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "agent_config_identity_id_namespace_kind_pk" PRIMARY KEY("identity_id","namespace","kind")
);
--> statement-breakpoint
CREATE TABLE "agent_resource_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"name" text NOT NULL,
	"metadata" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"metadata" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "agent_resources_identity_id_sha256_unique" UNIQUE("identity_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "agent_runtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"base_revision" integer NOT NULL,
	"status" text NOT NULL,
	"merged_revision" integer
);
--> statement-breakpoint
CREATE TABLE "document_journal" (
	"document_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"codec" text NOT NULL,
	"data" "bytea" NOT NULL,
	"raw_size" integer NOT NULL,
	CONSTRAINT "document_journal_document_id_sequence_pk" PRIMARY KEY("document_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"document_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "members_document_id_identity_id_pk" PRIMARY KEY("document_id","identity_id")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"document_id" text NOT NULL,
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "receipts_document_id_id_pk" PRIMARY KEY("document_id","id")
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"document_id" text NOT NULL,
	"revision" integer NOT NULL,
	"sequence" integer NOT NULL,
	"actor" text NOT NULL,
	"message" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "revisions_document_id_revision_pk" PRIMARY KEY("document_id","revision")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"sequence" integer NOT NULL,
	"checkpoint_sequence" integer NOT NULL,
	"checkpoint_size" integer NOT NULL,
	"delta_bytes" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"starred" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"operation" text NOT NULL,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"payload" text NOT NULL,
	"result" text,
	"error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"attempt" integer NOT NULL,
	"request_key" text,
	"cancelled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"size" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_leases" (
	"file_id" text NOT NULL,
	"version" integer NOT NULL,
	"owner_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	CONSTRAINT "file_leases_file_id_version_scope_scope_id_pk" PRIMARY KEY("file_id","version","scope","scope_id")
);
--> statement-breakpoint
CREATE TABLE "file_refs" (
	"file_id" text NOT NULL,
	"version" integer NOT NULL,
	"document_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "file_refs_file_id_version_document_id_scope_scope_id_pk" PRIMARY KEY("file_id","version","document_id","scope","scope_id")
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"file_id" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"received" integer NOT NULL,
	"checksum" text,
	"request_key" text,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"result" text
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"file_id" text NOT NULL,
	"version" integer NOT NULL,
	"hash" text NOT NULL,
	"mime" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "file_versions_file_id_version_pk" PRIMARY KEY("file_id","version")
);
--> statement-breakpoint
CREATE TABLE "file_writes" (
	"owner_id" text NOT NULL,
	"request_key" text NOT NULL,
	"file_id" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "file_writes_owner_id_request_key_pk" PRIMARY KEY("owner_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"head" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"request_key" text
);
--> statement-breakpoint
ALTER TABLE "agent_resource_usages" ADD CONSTRAINT "agent_resource_usages_resource_id_agent_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."agent_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtimes" ADD CONSTRAINT "agent_runtimes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_source_id_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_journal" ADD CONSTRAINT "document_journal_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_leases" ADD CONSTRAINT "file_leases_file_id_version_file_versions_file_id_version_fk" FOREIGN KEY ("file_id","version") REFERENCES "public"."file_versions"("file_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_refs" ADD CONSTRAINT "file_refs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_refs" ADD CONSTRAINT "file_refs_file_id_version_file_versions_file_id_version_fk" FOREIGN KEY ("file_id","version") REFERENCES "public"."file_versions"("file_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_hash_file_blobs_hash_fk" FOREIGN KEY ("hash") REFERENCES "public"."file_blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_writes" ADD CONSTRAINT "file_writes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_journal_checkpoints" ON "document_journal" USING btree ("document_id","kind","sequence");--> statement-breakpoint
CREATE INDEX "documents_modified" ON "documents" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_request" ON "exchange_jobs" USING btree ("owner_id","request_key");--> statement-breakpoint
CREATE INDEX "file_refs_document" ON "file_refs" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_request" ON "files" USING btree ("owner_id","request_key");