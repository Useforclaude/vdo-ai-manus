import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { EditPlan } from "../shared/editing";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const videoProjects = mysqlTable("video_projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
  sourceStorageKey: varchar("sourceStorageKey", { length: 512 }).notNull(),
  sourceUrl: text("sourceUrl").notNull(),
  sourceMimeType: varchar("sourceMimeType", { length: 128 }).notNull(),
  sourceBytes: int("sourceBytes").notNull(),
  durationSeconds: int("durationSeconds"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const editJobs = mysqlTable("edit_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: int("projectId").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  commandLanguage: mysqlEnum("commandLanguage", ["th", "en", "mixed", "unknown"]).notNull().default("unknown"),
  operationPlan: json("operationPlan").$type<EditPlan>().notNull(),
  status: mysqlEnum("status", ["queued", "processing", "complete", "failed"]).notNull().default("queued"),
  progress: int("progress").notNull().default(0),
  processedStorageKey: varchar("processedStorageKey", { length: 512 }),
  processedUrl: text("processedUrl"),
  subtitleStorageKey: varchar("subtitleStorageKey", { length: 512 }),
  subtitleUrl: text("subtitleUrl"),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type VideoProject = typeof videoProjects.$inferSelect;
export type InsertVideoProject = typeof videoProjects.$inferInsert;
export type EditJob = typeof editJobs.$inferSelect;
export type InsertEditJob = typeof editJobs.$inferInsert;
