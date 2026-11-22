import { site } from "@/lib/site";

const facts = [
	{ label: "License", value: "AGPL-3.0" },
	{ label: "Runs on", value: "Docker" },
	{ label: "Needs", value: "Postgres and Trigger.dev" },
	{ label: "Models", value: "Your own model provider" },
];

export function OpenSource() {
	return (
		<section id="self-host" className="border-y-2 border-ink bg-surface">
			<div className="mx-auto grid max-w-310 items-start gap-10 px-6 py-16 md:px-10 md:py-20 lg:grid-cols-2">
				<div className="flex flex-col gap-5">
					<h2 className="max-w-[20ch] text-[clamp(30px,4vw,40px)] font-semibold leading-[1.1] tracking-[-0.035em]">
						Open source. Host it yourself.
					</h2>
					<p className="max-w-[52ch] text-lg leading-relaxed text-muted">
						The code is public. Run your own copy, or use ours. Both are the
						same code. If you change it and let other people use it over a
						network, the license asks you to share your changes.
					</p>
					<div className="flex flex-wrap items-center gap-4">
						<a
							href={site.repoUrl}
							className="pixel pressable inline-flex h-10.5 items-center bg-surface px-5 text-sm font-medium"
						>
							View the source
						</a>
						<p className="font-mono text-xs text-subtle">
							Setup guide: coming before launch
						</p>
					</div>
				</div>

				<dl className="pixel flex flex-col gap-4 bg-background p-6 [--drop:6px]">
					{facts.map((fact) => (
						<div
							key={fact.label}
							className="flex items-baseline justify-between gap-4 border-b border-border pb-4 last:border-b-0 last:pb-0"
						>
							<dt className="font-mono text-xs uppercase text-subtle">
								{fact.label}
							</dt>
							<dd className="text-right font-medium">{fact.value}</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}
