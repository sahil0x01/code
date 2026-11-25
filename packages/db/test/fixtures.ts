import { randomInt, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { createDb, installation, project, user } from "../src/index";
import { testDatabase } from "./database-url";

export function connect() {
	return createDb(testDatabase().url);
}

type TestDb = ReturnType<typeof connect>;

// Every test makes its own users, so tests never share rows and can run in any
// order. Deleting the users at the end removes everything else through the
// ON DELETE CASCADE foreign keys.
export class Fixtures {
	private userIds: string[] = [];

	constructor(private db: TestDb) {}

	async user() {
		const id = `test-${randomUUID()}`;
		await this.db
			.insert(user)
			.values({ id, name: "Test User", email: `${id}@example.test` });
		this.userIds.push(id);
		return id;
	}

	async project(userId: string, options: { connected?: boolean } = {}) {
		let installationId: number | null = null;

		if (options.connected !== false) {
			installationId = randomInt(1, 2 ** 40);
			await this.db.insert(installation).values({
				id: installationId,
				userId,
				accountId: randomInt(1, 2 ** 40),
				accountLogin: "acme",
				accountType: "User",
				repositorySelection: "selected",
			});
		}

		const [row] = await this.db
			.insert(project)
			.values({
				userId,
				installationId,
				githubRepoId: randomInt(1, 2 ** 40),
				fullName: `acme/${randomUUID().slice(0, 8)}`,
				defaultBranch: "main",
				isPrivate: false,
			})
			.returning({ id: project.id });
		if (!row) throw new Error("project insert returned no row");
		return row.id;
	}

	async cleanup() {
		if (this.userIds.length > 0) {
			await this.db.delete(user).where(inArray(user.id, this.userIds));
		}
	}
}
