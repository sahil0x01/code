import { site } from "@/lib/site";
import { RunPreview } from "./run-demo/run-preview";
import { WaitlistForm } from "./waitlist-form";

export function Hero() {
	return (
		<section className="mx-auto flex max-w-310 flex-col gap-12 px-6 pb-14 pt-16 md:px-10 md:pt-20">
			<div className="flex flex-wrap items-end justify-between gap-8">
				<h1 className="max-w-[14ch] text-[clamp(44px,6vw,80px)] font-semibold leading-[1.02] tracking-tighter">
					Give it a task. Get a <span className="highlight">pull request</span>.
				</h1>

				<div className="flex w-full max-w-md flex-col gap-5">
					<p className="text-lg leading-relaxed text-muted">
						{site.description}
					</p>
					<div id="waitlist" className="flex scroll-mt-6 flex-col gap-3">
						<WaitlistForm />
						<p className="text-sm text-muted">
							200 free credits to start. No card needed.
						</p>
					</div>
					<a
						href={site.repoUrl}
						className="w-fit text-sm text-muted underline hover:text-foreground"
					>
						View on GitHub
					</a>
				</div>
			</div>

			<RunPreview />
		</section>
	);
}
