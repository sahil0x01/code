import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Policy">
			<p>Coming soon.</p>
		</LegalPage>
	);
}
