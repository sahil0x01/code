import { CREDITS_PER_DOLLAR, freeCredits, packs } from "@/lib/pricing";

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-US");

export function Pricing() {
	return (
		<section id="pricing">
			<div className="mx-auto flex max-w-[1240px] flex-col gap-9 px-6 py-16 md:px-10 md:py-20">
				<div className="flex flex-col gap-4">
					<h2 className="max-w-[20ch] text-[clamp(30px,4vw,40px)] font-semibold leading-[1.1] tracking-[-0.035em]">
						Start free. Pay only for what you run.
					</h2>
					<p className="max-w-[52ch] text-lg leading-relaxed text-muted">
						No subscription. Buy credits when you need them. 1 credit costs 1
						cent.
					</p>
				</div>

				<ul className="grid gap-7 sm:grid-cols-2 lg:grid-cols-5">
					<li className="pixel flex flex-col gap-3 bg-accent p-6 text-accent-foreground [--drop:6px]">
						<p className="font-mono text-xs uppercase">free</p>
						<p className="text-4xl font-semibold tracking-tight">$0</p>
						<p className="font-medium">{num.format(freeCredits)} credits</p>
						<p className="text-sm">One time. Enough for a run or two.</p>
					</li>

					{packs.map((pack) => {
						const bonus = pack.credits - pack.price * CREDITS_PER_DOLLAR;
						return (
							<li
								key={pack.price}
								className="pixel flex flex-col gap-3 bg-surface p-6 [--drop:6px]"
							>
								<p className="font-mono text-xs uppercase text-subtle">
									credit pack
								</p>
								<p className="text-4xl font-semibold tracking-tight">
									{usd.format(pack.price)}
								</p>
								<p className="font-medium">
									{num.format(pack.credits)} credits
								</p>
								<p className="text-sm text-muted">
									{bonus > 0
										? `Includes ${num.format(bonus)} bonus credits`
										: "No bonus"}
								</p>
							</li>
						);
					})}
				</ul>

				<ul className="flex flex-col gap-2 text-sm text-muted">
					<li>
						You see an estimated cost before every run, and your balance while
						it runs.
					</li>
					<li>
						Each free run stops at 100 credits and keeps the work it has done.
					</li>
					<li>Purchased credits expire 12 months after purchase.</li>
				</ul>

				<a
					href="#waitlist"
					className="pixel pressable inline-flex h-[42px] w-fit items-center bg-accent px-5 text-sm font-medium text-accent-foreground"
				>
					Join the waitlist
				</a>
			</div>
		</section>
	);
}
