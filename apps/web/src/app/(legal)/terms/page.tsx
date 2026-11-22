import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service">
			<p>Coming soon.</p>
		</LegalPage>
	);
}
