import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Acceptable Use Policy" };

export default function AcceptableUsePage() {
	return (
		<LegalPage title="Acceptable Use Policy">
			<p>Coming soon.</p>
		</LegalPage>
	);
}
