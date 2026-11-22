export type StepStatus = "waiting" | "running" | "done";
export type Screen = "connect" | "projects" | "task" | "run";
export type Tab = "log" | "changes" | "recording";
export type Scene = ReturnType<typeof sceneAt>;

export const TASK = "Users stay logged in after their session expires";

export const CYCLE_MS = 20500;
export const FINAL_FRAME_MS = 17500;

const STARTING_BALANCE = 200;
const TOTAL_CREDITS = 86;

const PROJECTS_AT = 800;
const TASK_AT = 2200;
const TYPE_START = 2600;
const TYPE_MS_PER_CHAR = 40;
const RUN_START = 5200;
const RUN_END = 16000;

const stepDefs = [
	{ label: "Read the repository", start: 5200, end: 6400 },
	{ label: "Fix the session expiry check", start: 6400, end: 8400 },
	{ label: "Run the tests", start: 8400, end: 9800 },
	{ label: "Verify in the browser", start: 9800, end: 15000 },
	{ label: "Open a pull request", start: 15000, end: 16000 },
];

const logLines = [
	{ at: 5300, text: "> reading src/auth/session.ts" },
	{ at: 5800, text: "> reading src/auth/middleware.ts" },
	{ at: 6300, text: "> found: expiry is never checked" },
	{ at: 7000, text: "> editing src/auth/session.ts" },
	{ at: 7700, text: "> +2 -1" },
	{ at: 8500, text: "$ pnpm test" },
	{ at: 9300, text: "  42 passed" },
	{ at: 9900, text: "> starting the app on :3000" },
	{ at: 10500, text: "> opening a browser, signing in" },
	{ at: 11500, text: "> recording the session expiry" },
	{ at: 14800, text: "> saved recording" },
	{ at: 15200, text: "> pushing branch fix-session-expiry" },
	{ at: 15800, text: "> opening pull request" },
];

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

function screenAt(t: number): Screen {
	if (t < PROJECTS_AT) return "connect";
	if (t < TASK_AT) return "projects";
	if (t < RUN_START) return "task";
	return "run";
}

function tabAt(t: number): Tab {
	if (t >= 15000) return "log";
	if (t >= 9800) return "recording";
	if (t >= 8400) return "log";
	if (t >= 7400) return "changes";
	return "log";
}

const urls: Record<Screen, string> = {
	connect: "/projects",
	projects: "/projects",
	task: "/tasks/new",
	run: "/runs/128",
};

const navs: Record<Screen, string> = {
	connect: "Projects",
	projects: "Projects",
	task: "Tasks",
	run: "Runs",
};

export function sceneAt(t: number) {
	const screen = screenAt(t);
	const tab = tabAt(t);
	const typedLength = clamp(
		Math.floor((t - TYPE_START) / TYPE_MS_PER_CHAR),
		0,
		TASK.length,
	);
	const spent = Math.round(
		TOTAL_CREDITS * clamp((t - RUN_START) / (RUN_END - RUN_START), 0, 1),
	);

	return {
		screen,
		url: urls[screen],
		nav: navs[screen],
		pressed:
			(t >= 600 && t < 800) ||
			(t >= 2000 && t < 2200) ||
			(t >= 5000 && t < RUN_START),
		typed: TASK.slice(0, typedLength),
		typing: t >= TYPE_START && typedLength < TASK.length,
		estimateShown: t >= TYPE_START + TASK.length * TYPE_MS_PER_CHAR,
		finished: t >= RUN_END,
		steps: stepDefs.map((step) => ({
			label: step.label,
			status: (t < step.start
				? "waiting"
				: t < step.end
					? "running"
					: "done") as StepStatus,
		})),
		logs: logLines
			.filter((line) => t >= line.at)
			.slice(-9)
			.map((line) => line.text),
		spent,
		balance: STARTING_BALANCE - spent,
		tab,
		prShown: t >= 16100,
		noticeShown: t >= 16900,
	};
}
