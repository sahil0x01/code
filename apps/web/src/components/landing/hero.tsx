import { site } from "@/lib/site";

type StepStatus = "done" | "running" | "waiting";

const steps: { label: string; status: StepStatus }[] = [
	{ label: "Read the repository", status: "done" },
	{ label: "Fix the session expiry check", status: "done" },
	{ label: "Run the tests", status: "running" },
	{ label: "Open a pull request", status: "waiting" },
];

const boxStyle: Record<StepStatus, string> = {
	done: "bg-green",
	running: "bg-blue blink",
	waiting: "bg-surface",
};

function RunPreview() {
	return (
		<div className="flex flex-col gap-2">
			<p className="font-mono text-xs uppercase text-subtle">example run</p>
			<div className="pixel flex flex-col gap-6 bg-surface p-6 [--drop:8px] md:p-8">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="font-mono text-xs text-subtle">task</p>
						<p className="text-lg font-semibold tracking-tight">
							Users stay logged in after their session expires
						</p>
					</div>
					<span className="pixel-flat bg-blue px-2 py-1 font-mono text-[10px] uppercase text-white">
						running
					</span>
				</div>

				<ol className="flex flex-col gap-3">
					{steps.map((step) => (
						<li
							key={step.label}
							className="flex items-center gap-3 text-[15px]"
						>
							<span
								aria-hidden="true"
								className={`pixel-inset size-4 ${boxStyle[step.status]}`}
							/>
							<span className="sr-only">{step.status}:</span>
							<span className={step.status === "waiting" ? "text-muted" : ""}>
								{step.label}
							</span>
						</li>
					))}
				</ol>

				<div className="pixel-inset flex items-center justify-between gap-4 bg-background p-3 font-mono text-sm">
					<span>
						$ pnpm test{" "}
						<span className="blink inline-block h-4 w-2 bg-foreground align-middle" />
					</span>
					<span className="text-muted">12 credits</span>
				</div>
			</div>
		</div>
	);
}

export function Hero() {
	return (
		<section className="mx-auto flex max-w-310 flex-col gap-12 px-6 pb-14 pt-16 md:px-10 md:pt-20">
			<div className="flex flex-wrap items-end justify-between gap-8">
				<h1 className="max-w-[14ch] text-[clamp(44px,6vw,80px)] font-semibold leading-[1.02] tracking-tighter">
					Give it a task. Get a <span className="highlight">pull request</span>.
				</h1>

				<div className="flex max-w-md flex-col gap-5">
					<p className="text-lg leading-relaxed text-muted">
						{site.description}
					</p>
					<div className="flex flex-wrap gap-3">
						<a
							href="#waitlist"
							className="pixel pressable inline-flex h-10.5 items-center bg-accent px-5 text-sm font-medium text-accent-foreground"
						>
							Join the waitlist
						</a>
						<a
							href={site.repoUrl}
							className="pixel pressable inline-flex h-10.5 items-center bg-surface px-5 text-sm font-medium"
						>
							View on GitHub
						</a>
					</div>
				</div>
			</div>

			<RunPreview />
		</section>
	);
}
