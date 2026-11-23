const faqs = [
	{
		question: "What happens to my code?",
		answer:
			"Each run happens in an isolated sandbox that is deleted when the run ends. If a run is interrupted, we may keep a temporary snapshot of the sandbox for up to 24 hours so it can resume, then delete it. We do not keep other copies of your repository, your code stays in GitHub. We keep run logs for 30 days on the free plan and 90 days once you have bought credits.",
	},
	{
		question: "Which models does it use?",
		answer:
			"Open-weight models only. We never use closed models. Our privacy policy names the provider that runs them.",
	},
	{
		question: "What does a run cost?",
		answer:
			"It depends on the task. You see an estimate before you start and the cost so far while it runs. The free credits cover a run or two.",
	},
	{
		question: "What can it access on GitHub?",
		answer:
			"Only the repositories you choose when you install the GitHub app. It can read and write code and pull requests in those repositories, and nothing else.",
	},
	{
		question: "Can it change my main branch?",
		answer:
			"It works on its own branch and opens a pull request. Nothing reaches your main branch until you merge it.",
	},
	{
		question: "Can I run it myself?",
		answer:
			"Yes. It is open source under the AGPL-3.0 license. A setup guide is coming before launch.",
	},
];

export function Faq() {
	return (
		<section id="faq">
			<div className="mx-auto flex max-w-310 flex-col gap-9 px-6 py-16 md:px-10 md:py-20">
				<h2 className="max-w-[20ch] text-[clamp(30px,4vw,40px)] font-semibold leading-[1.1] tracking-[-0.035em]">
					Questions
				</h2>

				<div className="flex max-w-3xl flex-col gap-5">
					{faqs.map((faq) => (
						<details
							key={faq.question}
							className="group pixel bg-surface p-5 [--drop:4px]"
						>
							<summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
								{faq.question}
								<span
									aria-hidden="true"
									className="font-mono group-open:hidden"
								>
									+
								</span>
								<span
									aria-hidden="true"
									className="hidden font-mono group-open:inline"
								>
									-
								</span>
							</summary>
							<p className="mt-3 leading-relaxed text-muted">{faq.answer}</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}
