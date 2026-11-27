import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service" updated="27 November 2026">
			<p>
				These terms cover your use of Prefill Code, including this website, the
				waitlist, and the early access service. They are written to be read. If
				something is unclear, write to us.
			</p>

			<h2>Who we are</h2>
			<p>
				Prefill Code is run by {site.legalName}, an individual based in India.
				You can reach us at {site.contactEmail}.
			</p>

			<h2>What this is</h2>
			<p>
				Prefill Code is a coding agent that is still in development. Early
				access is offered as is. It can change, break, or be paused. We will
				tell you before anything that affects your data.
			</p>

			<h2>Your code stays yours</h2>
			<ul>
				<li>
					You own your repositories, your tasks, and the pull requests the agent
					opens for you.
				</li>
				<li>
					You allow us to read and write only what is needed to run the tasks
					you start, and only in the repositories you choose.
				</li>
				<li>
					We claim no rights in your code or in what the agent produces for you.
				</li>
			</ul>

			<h2>Our privacy commitments</h2>
			<ul>
				<li>
					We do not sell your data and we do not share it for advertising.
				</li>
				<li>
					We do not use your code, your tasks, or the output of your runs to
					train models.
				</li>
				<li>
					Each run happens in an isolated sandbox that is deleted when the run
					ends. A run that is interrupted may keep a temporary snapshot for up
					to 24 hours so that it can resume. We do not keep copies of your
					repository.
				</li>
				<li>
					We ask only for the GitHub access we need, and only for the
					repositories you choose.
				</li>
				<li>
					We keep run logs for a limited time and delete your data when you
					delete your account. The <Link href="/privacy">Privacy Policy</Link>{" "}
					gives the exact periods and lists the services that process data for
					us.
				</li>
			</ul>

			<h2>Your responsibilities</h2>
			<ul>
				<li>Only point the agent at code you have the right to use.</li>
				<li>
					Keep secrets such as passwords and API keys out of task descriptions.
					Task text is sent to the model that does the work.
				</li>
				<li>Review the agent work before you merge it.</li>
			</ul>

			<h2>Using your own model key</h2>
			<ul>
				<li>
					You can add your own API key for a model provider, or the address of a
					compatible server. Only use keys and servers you are allowed to use.
				</li>
				<li>
					Runs and connection tests that use your key send your messages, and the
					code and command output the agent reads, to that provider. Its terms
					and privacy rules apply, and it bills you directly.
				</li>
				<li>
					Costs we show for your key are estimates from public list prices.
					Your provider&apos;s bill is what counts. Limits can stop a run only
					after a step has finished, so set spending limits with your provider
					too.
				</li>
			</ul>

			<h2>The agent can be wrong</h2>
			<p>
				The agent is an AI system. Its output can be incorrect, incomplete, or
				insecure. It opens pull requests so that you can review them, and
				nothing reaches your main branch until you merge it.
			</p>

			<h2>Acceptable use</h2>
			<p>
				Do not use the service to harm others or to attack systems. The{" "}
				<Link href="/acceptable-use">Acceptable Use Policy</Link> has the
				details.
			</p>

			<h2>Open source</h2>
			<p>
				The source code of Prefill Code is released under the AGPL-3.0 license.
				These terms cover the hosted service. The license covers the code, and
				it is what applies if you run your own copy.
			</p>

			<h2>Payments</h2>
			<p>
				Paid credits are not available yet. Before they are, we will add the
				payment terms here and tell the people on the waitlist.
			</p>

			<h2>Ending your use</h2>
			<p>
				You can stop using the service, and ask us to delete your data, at any
				time. We may suspend access that breaks these terms or the Acceptable
				Use Policy.
			</p>

			<h2>Limits of our responsibility</h2>
			<p>
				The service is provided as is. To the extent the law allows, we are not
				responsible for losses that come from using it, including lost data or
				lost profits, and our total responsibility to you is limited to the
				amount you paid us in the last twelve months. Nothing here limits rights
				that the law does not allow us to limit.
			</p>

			<h2>Governing law</h2>
			<p>
				These terms are governed by the laws of India. Disputes go to the courts
				in {site.legalCity}.
			</p>

			<h2>Changes</h2>
			<p>
				We may update these terms. We will change the date at the top and, for
				changes that matter, tell you in the app or by email.
			</p>

			<h2>Contact</h2>
			<p>Questions about these terms: {site.contactEmail}.</p>
		</LegalPage>
	);
}
