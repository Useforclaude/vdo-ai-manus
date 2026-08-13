import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  editJobs,
  InsertEditJob,
  InsertUser,
  InsertVideoProject,
  users,
  videoProjects,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new Error("Database is unavailable");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod", "role"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] as never;
      updateSet[field] = user[field];
    }
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getOrCreateGuestUser(guestToken: string) {
  const openId = `guest:${guestToken}`;
  const db = requireDb(await getDb());
  const now = new Date();
  await db.insert(users).values({
    openId,
    name: "Cineflow guest",
    loginMethod: "guest",
    role: "user",
    lastSignedIn: now,
  }).onDuplicateKeyUpdate({ set: { lastSignedIn: now } });
  const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!rows[0]) throw new Error("Unable to create guest session");
  return rows[0];
}

export async function createVideoProject(values: InsertVideoProject) {
  const db = requireDb(await getDb());
  const result = await db.insert(videoProjects).values(values);
  const created = await db.select().from(videoProjects).where(eq(videoProjects.id, Number(result[0].insertId))).limit(1);
  return created[0];
}

export async function getVideoProjectForUser(projectId: number, userId: number) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(videoProjects).where(and(eq(videoProjects.id, projectId), eq(videoProjects.userId, userId))).limit(1);
  return rows[0];
}

export async function updateVideoProjectDuration(projectId: number, userId: number, durationSeconds: number) {
  const db = requireDb(await getDb());
  await db.update(videoProjects).set({ durationSeconds }).where(and(eq(videoProjects.id, projectId), eq(videoProjects.userId, userId)));
}

export async function createEditJob(values: InsertEditJob) {
  const db = requireDb(await getDb());
  await db.insert(editJobs).values(values);
  const rows = await db.select().from(editJobs).where(eq(editJobs.id, values.id)).limit(1);
  return rows[0];
}

export async function getEditJobForUser(jobId: string, userId: number) {
  const db = requireDb(await getDb());
  const rows = await db.select().from(editJobs).where(and(eq(editJobs.id, jobId), eq(editJobs.userId, userId))).limit(1);
  return rows[0];
}

export async function listEditJobsForUser(userId: number) {
  const db = requireDb(await getDb());
  return db.select().from(editJobs).where(eq(editJobs.userId, userId)).orderBy(desc(editJobs.createdAt));
}

export async function updateEditJob(jobId: string, userId: number, values: Partial<InsertEditJob>) {
  const db = requireDb(await getDb());
  await db.update(editJobs).set(values).where(and(eq(editJobs.id, jobId), eq(editJobs.userId, userId)));
  return getEditJobForUser(jobId, userId);
}
