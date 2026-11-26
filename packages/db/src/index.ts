import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
	const pool = new Pool({ connectionString });
	return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

export * from "./account";
export * from "./chats";
export * from "./installations";
export * from "./preferences";
export * from "./projects";
export * from "./runs";
export * from "./schema";
