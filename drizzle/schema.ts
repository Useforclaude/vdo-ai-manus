import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { EditPlan } from "../shared/editing";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export const videoProjects = mysqlTable("video_projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceFileName: varchar("source_file_name", { length: 512 }).notNull(),
  sourceStorageKey: varchar("source_storage_key", { length: 1024 }),
  sourceUrl: text("source_url"),
  sourceMimeType: varchar("source_mime_type", { length: 255 }).notNull(),
  sourceBytes: int("source_bytes").notNull(),
  durationSeconds: int("duration_seconds"),
  expiresAt: timestamp("expires_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const videoClips = mysqlTable("video_clips", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  userId: int("user_id").notNull(),
  sortOrder: int("sort_order").notNull(),
  originalName: varchar("original_name", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }).notNull(),
  sizeBytes: int("size_bytes").notNull(),
  storageKey: varchar("storage_key", { length: 1024 }).notNull(),
  storageUrl: text("storage_url").notNull(),
  trimStartMs: int("trim_start_ms"),
  trimEndMs: int("trim_end_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  index("video_clips_project_order_idx").on(table.projectId, table.sortOrder),
  index("video_clips_user_project_idx").on(table.userId, table.projectId),
]);

export const subtitlePresets = mysqlTable("subtitle_presets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  font: varchar("font", { length: 120 }).notNull().default("Noto Sans Thai"),
  size: mysqlEnum("size", ["small", "medium", "large"]).notNull().default("medium"),
  position: mysqlEnum("position", ["bottom", "middle", "top"]).notNull().default("bottom"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("subtitle_presets_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const mcpAccessTokens = mysqlTable("mcp_access_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  projectId: int("project_id").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  scope: mysqlEnum("scope", ["read", "edit", "render"]).notNull().default("read"),
  expiresAt: timestamp("expires_at").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  index("mcp_tokens_user_project_idx").on(table.userId, table.projectId),
  index("mcp_tokens_active_idx").on(table.tokenHash, table.expiresAt),
]);

export const editJobs = mysqlTable("edit_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: int("project_id").notNull(),
  userId: int("user_id").notNull(),
  command: text("command").notNull(),
  commandLanguage: varchar("command_language", { length: 16 }).notNull().default("unknown"),
  operationPlan: json("operation_plan").$type<EditPlan>().notNull(),
  status: mysqlEnum("status", ["queued", "processing", "complete", "failed"]).notNull().default("queued"),
  progress: int("progress").notNull().default(0),
  processedStorageKey: varchar("processed_storage_key", { length: 1024 }),
  processedUrl: text("processed_url"),
  subtitleStorageKey: varchar("subtitle_storage_key", { length: 1024 }),
  subtitleUrl: text("subtitle_url"),
  subtitleFont: varchar("subtitle_font", { length: 120 }).notNull().default("Noto Sans Thai"),
  subtitleSize: mysqlEnum("subtitle_size", ["small", "medium", "large"]).notNull().default("medium"),
  subtitlePosition: mysqlEnum("subtitle_position", ["bottom", "middle", "top"]).notNull().default("bottom"),
  subtitlePreset: mysqlEnum("subtitle_preset", ["thai_standard", "thai_story", "thai_minimal", "custom"]).notNull().default("thai_standard"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type VideoProject = typeof videoProjects.$inferSelect;
export type InsertVideoProject = typeof videoProjects.$inferInsert;
export type VideoClip = typeof videoClips.$inferSelect;
export type InsertVideoClip = typeof videoClips.$inferInsert;
export type SubtitlePreset = typeof subtitlePresets.$inferSelect;
export type InsertSubtitlePreset = typeof subtitlePresets.$inferInsert;
export type McpAccessToken = typeof mcpAccessTokens.$inferSelect;
export type EditJob = typeof editJobs.$inferSelect;
export type InsertEditJob = typeof editJobs.$inferInsert;
