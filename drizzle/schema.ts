import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
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
  sourceStorageKey: varchar("source_storage_key", { length: 1024 }).notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceMimeType: varchar("source_mime_type", { length: 255 }).notNull(),
  sourceBytes: int("source_bytes").notNull(),
  durationSeconds: int("duration_seconds"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

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
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type VideoProject = typeof videoProjects.$inferSelect;
export type InsertVideoProject = typeof videoProjects.$inferInsert;
export type EditJob = typeof editJobs.$inferSelect;
export type InsertEditJob = typeof editJobs.$inferInsert;
