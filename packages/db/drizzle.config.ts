import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
	process.loadEnvFile("../../apps/web/.env.local");
}

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema.ts",
	out: "./drizzle",
	dbCredentials: { url },
});
