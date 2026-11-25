const DEFAULT_URL = "postgres://nullfuse:nullfuse@localhost:5432/nullfuse_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Tests write and delete rows, so they never touch the development database.
// They use their own database on the same server, and refuse to run against
// anything that is not on this machine or whose name does not say "test".
export function testDatabase() {
	const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
	const name = url.pathname.slice(1);

	if (!LOCAL_HOSTS.has(url.hostname)) {
		throw new Error(
			`Refusing to run tests against ${url.hostname}: the test database must be local.`,
		);
	}
	if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) {
		throw new Error(
			`Refusing to run tests against "${name}": the database name must contain "test".`,
		);
	}

	const admin = new URL(url);
	admin.pathname = "/postgres";

	return { url: url.href, adminUrl: admin.href, name };
}
