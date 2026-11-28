import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
	const pool = new Pool({ connectionString });
	return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

export * from "./account";
export * from "./attachments";
export * from "./chats";
export * from "./connectors";
export * from "./inbox";
export * from "./installations";
export * from "./preferences";
export * from "./projects";
export * from "./recordings";
export * from "./runs";
export * from "./schema";
export * from "./stats";
export * from "./user-models";
