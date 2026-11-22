import { useEffect, useRef, useState } from "react";
import { show } from "./app-window";
import { type Scene, type StepStatus, type Tab, TASK } from "./timeline";

const boxStyle: Record<StepStatus, string> = {
	done: "bg-green",
	running: "bg-blue blink",
	waiting: "bg-surface",
};

const tabs: { id: Tab; label: string }[] = [
	{ id: "log", label: "Log" },
	{ id: "changes", label: "Changes" },
	{ id: "recording", label: "Recording" },
];

function ScreenHeader({
	crumbs,
	balance,
}: {
	crumbs: string;
	balance: number;
}) {
	return (
		<div className="flex items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
			<p className="truncate font-mono text-xs text-muted">{crumbs}</p>
			<span className="pixel-flat shrink-0 bg-surface px-2 py-1 font-mono text-[10px] uppercase">
				{balance} credits
			</span>
		</div>
	);
}

function FakeButton({
	children,
	pressed = false,
	primary = true,
}: {
	children: string;
	pressed?: boolean;
	primary?: boolean;
}) {
	return (
		<span
			className={`pixel inline-flex h-9 shrink-0 items-center px-4 text-sm font-medium ${
				primary ? "bg-accent text-accent-foreground" : "bg-surface"
			} ${pressed ? "translate-y-0.5" : ""}`}
		>
			{children}
		</span>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-2">
			<p className="font-mono text-xs text-subtle">{label}</p>
			<div className="pixel-inset bg-background px-3 py-2 font-mono text-sm">
				{value}
			</div>
		</div>
	);
}

export function ConnectScreen({ scene }: { scene: Scene }) {
	return (
		<>
			<ScreenHeader crumbs="Projects" balance={scene.balance} />
			<div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
				<p className="text-lg font-semibold tracking-tight">No projects yet</p>
				<p className="max-w-xs text-sm text-muted">
					Connect GitHub and choose the repositories Code can work on.
				</p>
				<FakeButton pressed={scene.pressed}>Connect GitHub</FakeButton>
			</div>
		</>
	);
}

export function ProjectsScreen({ scene }: { scene: Scene }) {
	return (
		<>
			<ScreenHeader crumbs="Projects" balance={scene.balance} />
			<div className="flex flex-col gap-4 p-4 md:p-6">
				<p className="text-lg font-semibold tracking-tight">Projects</p>
				<div className="pixel flex flex-wrap items-center justify-between gap-3 bg-surface p-4 [--drop:4px]">
					<div>
						<p className="font-mono text-sm">acme/web-app</p>
						<p className="font-mono text-xs text-muted">default branch: main</p>
					</div>
					<div className="flex items-center gap-3">
						<span className="pixel-flat bg-green px-2 py-1 font-mono text-[10px] uppercase">
							connected
						</span>
						<FakeButton pressed={scene.pressed}>New task</FakeButton>
					</div>
				</div>
			</div>
		</>
	);
}

export function TaskScreen({ scene }: { scene: Scene }) {
	return (
		<>
			<ScreenHeader crumbs="Tasks / New" balance={scene.balance} />
			<div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
				<p className="text-lg font-semibold tracking-tight">New task</p>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Project" value="acme/web-app" />
					<Field label="Branch" value="main" />
				</div>
				<div className="flex flex-1 flex-col gap-2">
					<p className="font-mono text-xs text-subtle">Task</p>
					<div className="pixel-inset min-h-24 flex-1 bg-background p-3 text-lg font-semibold tracking-tight">
						{scene.typed}
						{scene.typing && (
							<span className="blink ml-0.5 inline-block h-5 w-2 bg-foreground align-middle" />
						)}
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<span
						className={`font-mono text-xs text-muted ${show(scene.estimateShown)}`}
					>
						Estimated cost: 60 to 90 credits
					</span>
					<FakeButton pressed={scene.pressed}>Start run</FakeButton>
				</div>
			</div>
		</>
	);
}

function RecordingPane({
	active,
	playing,
}: {
	active: boolean;
	playing: boolean;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (active && videoRef.current) {
			videoRef.current.currentTime = 0;
		}
	}, [active]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (active && playing) {
			void video.play().catch(() => {});
		} else {
			video.pause();
		}
	}, [active, playing]);

	if (failed) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-center font-mono text-xs text-muted">
				recording unavailable
			</div>
		);
	}

	return (
		<div className="relative h-full bg-background">
			<video
				ref={videoRef}
				src="/demo/verification.mp4"
				poster="/demo/poster.jpg"
				muted
				loop
				playsInline
				preload="auto"
				onError={() => setFailed(true)}
				className="h-full w-full object-contain"
			/>
			{active && (
				<span className="absolute left-2 top-2 flex items-center gap-1.5 bg-background px-2 py-1 font-mono text-[10px] uppercase">
					<span className="blink size-2 bg-red" />
					rec
				</span>
			)}
		</div>
	);
}

export function RunScreen({
	scene,
	playing,
}: {
	scene: Scene;
	playing: boolean;
}) {
	return (
		<>
			<ScreenHeader crumbs="Runs / #128" balance={scene.balance} />

			<div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
				<div className="min-w-0">
					<p className="truncate font-semibold tracking-tight">{TASK}</p>
					<p className="font-mono text-xs text-muted">acme/web-app on main</p>
				</div>
				<div className="flex items-center gap-3">
					<span
						className={`pixel-flat px-2 py-1 font-mono text-[10px] uppercase ${
							scene.finished ? "bg-green" : "bg-blue text-white"
						}`}
					>
						{scene.finished ? "succeeded" : "running"}
					</span>
					<span className="font-mono text-xs">{scene.spent} credits</span>
					<span className={scene.finished ? "invisible" : ""}>
						<FakeButton primary={false}>Stop</FakeButton>
					</span>
				</div>
			</div>

			<div className="grid min-h-0 flex-1 md:grid-cols-[13rem_1fr]">
				<ol className="flex flex-col gap-3 border-b-2 border-ink p-4 md:border-b-0 md:border-r-2">
					{scene.steps.map((step) => (
						<li
							key={step.label}
							className="flex items-center gap-3 text-[15px]"
						>
							<span className={`pixel-inset size-4 ${boxStyle[step.status]}`} />
							<span className={step.status === "waiting" ? "text-muted" : ""}>
								{step.label}
							</span>
						</li>
					))}
				</ol>

				<div className="flex min-h-0 min-w-0 flex-col">
					<div className="flex border-b-2 border-ink font-mono text-xs uppercase">
						{tabs.map((tab) => (
							<span
								key={tab.id}
								className={`px-4 py-2 ${
									tab.id === scene.tab
										? "bg-accent text-accent-foreground"
										: "text-muted"
								}`}
							>
								{tab.label}
							</span>
						))}
					</div>

					<div className="min-h-0 flex-1 overflow-hidden">
						<div
							className={`flex flex-col gap-1 p-3 font-mono text-sm ${scene.tab === "log" ? "" : "hidden"}`}
						>
							{scene.logs.map((line) => (
								<p key={line} className="truncate">
									{line}
								</p>
							))}
						</div>

						<div
							className={`font-mono text-xs ${scene.tab === "changes" ? "" : "hidden"}`}
						>
							<p className="border-b-2 border-ink px-3 py-2">
								src/auth/session.ts <span className="text-green">+2</span>{" "}
								<span className="text-red">-1</span>
							</p>
							<div className="flex flex-col py-2">
								<p className="px-3 text-muted">
									{"export function isExpired(session: Session) {"}
								</p>
								<p className="bg-red/20 px-3">{"-  return false;"}</p>
								<p className="bg-green/20 px-3">
									{"+  const expiresAt = new Date(session.expiresAt);"}
								</p>
								<p className="bg-green/20 px-3">
									{"+  return Date.now() > expiresAt.getTime();"}
								</p>
								<p className="px-3 text-muted">{"}"}</p>
							</div>
						</div>

						<div
							className={`h-full ${scene.tab === "recording" ? "" : "hidden"}`}
						>
							<RecordingPane
								active={scene.tab === "recording"}
								playing={playing}
							/>
						</div>
					</div>
				</div>
			</div>

			<div
				className={`flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink bg-surface px-4 py-3 ${show(scene.prShown)}`}
			>
				<div>
					<p className="font-mono text-xs text-subtle">pull request #128</p>
					<p className="text-sm font-semibold">Fix session expiry check</p>
				</div>
				<div className="flex items-center gap-3">
					<span className="font-mono text-xs text-muted">
						+2 -1, 42 tests passed, video attached
					</span>
					<FakeButton>View on GitHub</FakeButton>
				</div>
			</div>
		</>
	);
}
