import { WaitlistForm } from "./waitlist-form";

export function Waitlist() {
	return (
		<section id="waitlist">
			<div className="mx-auto max-w-310 px-6 py-16 md:px-10 md:py-20">
				<div className="pixel flex max-w-2xl flex-col gap-5 bg-surface p-6 [--drop:8px] md:p-8">
					<h2 className="text-[clamp(30px,4vw,40px)] font-semibold leading-[1.1] tracking-[-0.035em]">
						Get early access.
					</h2>
					<p className="text-lg leading-relaxed text-muted">
						We are opening Code to a few people at a time. Leave your email and
						we will write when there is room. Nothing else.
					</p>
					<WaitlistForm />
				</div>
			</div>
		</section>
	);
}
