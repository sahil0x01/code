import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { testDatabase } from "./database-url";

// Runs once before all test files: make sure the test database exists and has
// every migration applied, so tests do not depend on a manual `pnpm db:migrate`.
export default async function setup() {
	const { url, adminUrl, name } = testDatabase();

	const admin = new Pool({ connectionString: adminUrl });
	try {
		const found = await admin.query(
			"select 1 from pg_database where datname = $1",
			[name],
		);
		if (found.rowCount === 0) {
			await admin.query(`create database "${name}"`);
		}
	} catch (error) {
		throw new Error(
			"Cannot reach Postgres to run tests. Start it with `pnpm db:up`.",
			{ cause: error },
		);
	} finally {
		await admin.end();
	}

	const pool = new Pool({ connectionString: url });
	try {
		await migrate(drizzle(pool), {
			migrationsFolder: path.join(import.meta.dirname, "../drizzle"),
		});
	} finally {
		await pool.end();
	}
}
