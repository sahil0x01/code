export type DetectedSetup = {
	installCommand: string;
	testCommand: string;
	startCommand: string;
	appPort: string;
};

type PackageJson = {
	packageManager?: unknown;
	scripts?: Record<string, unknown>;
	dependencies?: Record<string, unknown>;
	devDependencies?: Record<string, unknown>;
};

const nothing: DetectedSetup = { installCommand: "", testCommand: "", startCommand: "", appPort: "" };

// The first match wins, so frameworks come before the bundlers they are built on.
const PORTS: [dependency: string, port: string][] = [
	["next", "3000"],
	["nuxt", "3000"],
	["astro", "4321"],
	["react-scripts", "3000"],
	["@angular/core", "4200"],
	["@react-router/dev", "5173"],
	["@sveltejs/kit", "5173"],
	["vite", "5173"],
];

function manager(pkg: PackageJson, files: string[]) {
	const named = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
	if (named === "pnpm" || files.includes("pnpm-lock.yaml")) return "pnpm";
	if (named === "yarn" || files.includes("yarn.lock")) return "yarn";
	return "npm";
}

/**
 * Suggests setup commands from the files at the top of a repository. Install commands leave
 * the lockfile alone, so a run does not commit changes to it.
 */
export function detectSetup(files: string[], packageJson: string | null): DetectedSetup {
	if (packageJson === null) {
		return files.includes("index.html")
			? { ...nothing, startCommand: "npx --yes serve -l 3000 .", appPort: "3000" }
			: nothing;
	}
	let pkg: PackageJson;
	try {
		pkg = Object(JSON.parse(packageJson));
	} catch {
		return nothing;
	}

	const pm = manager(pkg, files);
	const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
	const script = (name: string) => {
		const value = pkg.scripts?.[name];
		return typeof value === "string" ? value : null;
	};

	let installCommand = "";
	if (Object.keys(dependencies).length > 0 || files.includes("pnpm-workspace.yaml")) {
		if (pm === "pnpm") installCommand = files.includes("pnpm-lock.yaml") ? "pnpm install --frozen-lockfile" : "pnpm install";
		else if (pm === "yarn") installCommand = "yarn install --frozen-lockfile";
		else installCommand = files.includes("package-lock.json") ? "npm ci" : "npm install --no-package-lock";
	}

	const test = script("test");
	const testCommand = test && !test.includes("no test specified") ? `${pm} test` : "";

	const name = script("dev") !== null ? "dev" : script("start") !== null ? "start" : null;
	// A port written into the script beats the framework's usual one.
	const written = name && /(?:--port|-p|-l)[ =](\d{2,5})\b/.exec(script(name) ?? "")?.[1];
	const port = written || PORTS.find(([dependency]) => dependency in dependencies)?.[1];
	// Both are needed to run the app, so a start command without a port is not suggested.
	const app = name && port ? { startCommand: `${pm} run ${name}`, appPort: port } : {};

	return { ...nothing, installCommand, testCommand, ...app };
}
