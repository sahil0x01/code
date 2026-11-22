const steps = [
	{
		title: "Connect a repository",
		body: "Install the GitHub app on the repositories you choose. It asks for the minimum access it needs.",
	},
	{
		title: "Describe the task",
		body: "Write what you want in plain language and pick a branch. You see the estimated cost before you start.",
	},
	{
		title: "Review the pull request",
		body: "The agent works in an isolated sandbox, checks its own work in a browser, and opens a pull request with a short video of it working. You get notified when it is done.",
	},
];

export function HowItWorks() {
	return (
		<section id="how" className="border-y-2 border-ink bg-surface">
			<div className="mx-auto flex max-w-310 flex-col gap-9 px-6 py-16 md:px-10 md:py-20">
				<h2 className="max-w-[20ch] text-[clamp(30px,4vw,40px)] font-semibold leading-[1.1] tracking-[-0.035em]">
					Three steps. You only write the first sentence.
				</h2>

				<ol className="grid gap-7 md:grid-cols-3">
					{steps.map((step, index) => (
						<li
							key={step.title}
							className="pixel flex flex-col gap-4 bg-background p-6 [--drop:6px]"
						>
							<span className="pixel-flat grid size-8 place-items-center bg-accent font-mono text-sm font-semibold text-accent-foreground">
								{index + 1}
							</span>
							<h3 className="text-xl font-semibold tracking-tight">
								{step.title}
							</h3>
							<p className="leading-relaxed text-muted">{step.body}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
