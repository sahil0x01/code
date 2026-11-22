import type { ReactNode } from "react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

export default function LegalLayout({ children }: { children: ReactNode }) {
	return (
		<>
			<Header />
			<main className="mx-auto max-w-3xl px-6 py-16 md:py-20">{children}</main>
			<Footer />
		</>
	);
}
