import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Acceptable Use Policy" };

export default function AcceptableUsePage() {
	return (
		<LegalPage title="Acceptable Use Policy" updated="22 November 2026">
			<p>
				Prefill Code runs code on your behalf in a sandbox. That is powerful,
				so we need clear rules about what it must not be used for. This policy
				is part of our <Link href="/terms">Terms of Service</Link>.
			</p>

			<h2>What you must not do</h2>
			<ul>
				<li>
					Attack, scan, or probe systems that you do not own or have clear
					permission to test. This includes denial of service and attempts to
					get into other accounts.
				</li>
				<li>
					Create or spread malware, ransomware, spyware, or code whose purpose
					is to harm other people.
				</li>
				<li>
					Mine cryptocurrency or use the sandbox for any heavy computing that is
					not part of your task.
				</li>
				<li>
					Try to break out of the sandbox, reach our systems, or reach other
					users runs or data.
				</li>
				<li>
					Use the service to break the law, to harass or threaten people, or to
					handle content that is illegal where you live or where we operate.
				</li>
				<li>
					Point the agent at code you have no right to use, or use it to remove
					the license terms of someone else work.
				</li>
				<li>
					Collect or process other peoples personal data in a way the law does
					not allow.
				</li>
			</ul>

			<h2>Fair use of credits and limits</h2>
			<ul>
				<li>
					Do not create multiple accounts to collect free credits, and do not
					work around run limits, rate limits, or credit checks.
				</li>
				<li>Do not sell or share access to your account.</li>
			</ul>

			<h2>What is fine</h2>
			<p>
				Testing the security of your own code is fine. So is running tests,
				builds, and scripts that belong to your repositories. If you find a
				weakness in our service, please report it privately, as described in our
				security policy, instead of using it. We will not take action against
				people who report problems in good faith.
			</p>

			<h2>Limits we put on runs</h2>
			<p>
				To keep everyone safe, runs have limits on time, resources, and network
				access. These limits can change, and a run that hits one will stop
				cleanly and keep the work it has done.
			</p>

			<h2>What happens if the rules are broken</h2>
			<ul>
				<li>We may stop a run that breaks these rules, without warning.</li>
				<li>
					We may remove credits that were gained by breaking the rules, and
					suspend or close the account.
				</li>
				<li>
					Where we can, we will tell you what happened. If you think we made a
					mistake, write to {site.contactEmail} and we will look again.
				</li>
			</ul>

			<h2>Reporting abuse</h2>
			<p>
				If you think someone is using Prefill Code to harm you or others, write
				to {site.contactEmail} with as much detail as you can.
			</p>

			<h2>Changes</h2>
			<p>
				We may update this policy. We will change the date at the top and, for
				changes that matter, tell you in the app or by email.
			</p>
		</LegalPage>
	);
}
