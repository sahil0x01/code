import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { testDatabase } from "./database-url";

const SETUP_LOCK = 727_001;

// Runs once before all test files: make sure the test database exists and has
// every migration applied, so tests do not depend on a manual `pnpm db:migrate`.
export default async function setup() {
	const { url, adminUrl, name } = testDatabase();

	const admin = new Pool({ connectionString: adminUrl });
	const lock = await admin.connect().catch(async (error) => {
		await admin.end();
		throw new Error("Cannot reach Postgres to run tests. Start it with `pnpm db:up`.", {
			cause: error,
		});
	});
	try {
		// Several packages run this at once against one database, so they take turns.
		await lock.query("select pg_advisory_lock($1)", [SETUP_LOCK]);
		const found = await lock.query("select 1 from pg_database where datname = $1", [name]);
		if (found.rowCount === 0) {
			await lock.query(`create database "${name}"`);
		}

		const pool = new Pool({ connectionString: url });
		try {
			await migrate(drizzle(pool), {
				migrationsFolder: path.join(import.meta.dirname, "../drizzle"),
			});
		} finally {
			await pool.end();
		}
	} finally {
		// Closing the connection releases the lock.
		lock.release(true);
		await admin.end();
	}
}
