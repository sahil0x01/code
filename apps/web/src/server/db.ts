import "server-only";
import { createDb, type Db } from "@nullfuse/db";
import { env } from "@/env";

const globalForDb = globalThis as unknown as { db?: Db };

export const db = globalForDb.db ?? createDb(env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
	globalForDb.db = db;
}
