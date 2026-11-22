import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Policy" updated="22 November 2026">
			<p>
				This policy explains what NullFuse Code does with your data. It
				describes what is live today: a website and a waitlist. We keep it short
				because we collect very little.
			</p>

			<h2>Who is responsible</h2>
			<p>
				{site.legalName}, an individual based in India, is responsible for your
				data. You can reach us at {site.contactEmail}.
			</p>

			<h2>What we collect</h2>
			<ul>
				<li>
					<strong>Waitlist.</strong> The email address you enter, and the time
					you entered it.
				</li>
				<li>
					<strong>Server logs.</strong> Like any website, our server records
					your IP address, the time, the page you asked for, and your browser
					type. We use this for security and to fix problems.
				</li>
			</ul>
			<p>
				That is all. We have no accounts yet, no advertising, and no analytics.
				The website sets no cookies. It saves your light or dark theme choice in
				your own browser, and that choice is never sent to us.
			</p>

			<h2>Why we use it</h2>
			<ul>
				<li>
					We use your waitlist email only to tell you when access opens. You
					gave it to us for that purpose, and we will not use it for anything
					else.
				</li>
				<li>
					We use server logs to keep the site secure and working, which is a
					legitimate interest of ours.
				</li>
			</ul>

			<h2>Who handles it for us</h2>
			<ul>
				<li>
					<strong>Vercel</strong> runs our website. Pages are delivered from servers
					around the world, and the code that handles the waitlist form runs in{" "}
					{site.hostingLocation}. Vercel also keeps the request logs.
				</li>
				<li>
					<strong>Neon</strong> stores our database. Your waitlist email is kept
					there, in {site.hostingLocation}.
				</li>
				<li>
					<strong>Resend</strong> sends our emails. When we write to you, your
					email address and the message pass through Resend.
				</li>
			</ul>
			<p>
				We do not sell your data and we do not share it for advertising. We do
				not share it with anyone else.
			</p>

			<h2>How long we keep it</h2>
			<ul>
				<li>
					Your waitlist email: until you ask us to remove it, or until we no
					longer need the waitlist, whichever comes first.
				</li>
				<li>
					Server logs: kept by Vercel for a short time, never more than 30 days.
					We keep no separate copy.
				</li>
			</ul>

			<h2>Your rights</h2>
			<p>
				You can ask us what we hold about you, ask us to correct it, ask us to
				delete it, and withdraw your consent at any time. Write to{" "}
				{site.contactEmail} and we will reply within 30 days. If you are not
				happy with our answer, you can also complain to your local data
				protection authority.
			</p>

			<h2>How we protect it</h2>
			<p>
				Connections to this site use HTTPS. The database that holds the waitlist
				accepts only encrypted connections and requires a password. We keep only
				what is listed here.
			</p>

			<h2>When the product launches</h2>
			<p>
				Accounts and coding runs will bring more data and more services. Before
				we use them, we will update this policy to say what we collect, which
				services process it, and for how long. The commitments in our{" "}
				<Link href="/terms">Terms of Service</Link> apply from the start: we do
				not use your code to train models, we do not keep copies of your
				repository, and you can delete your account and your data.
			</p>

			<h2>Changes</h2>
			<p>
				If we change this policy, we will update the date at the top and, for
				changes that matter, tell you by email or in the app.
			</p>

			<h2>Contact</h2>
			<p>Questions about your data: {site.contactEmail}.</p>
		</LegalPage>
	);
}
