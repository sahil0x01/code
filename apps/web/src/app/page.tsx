import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { OpenSource } from "@/components/landing/open-source";
import { Pricing } from "@/components/landing/pricing";

export default function Home() {
	return (
		<>
			<Header />
			<main>
				<Hero />
				<HowItWorks />
				<Pricing />
				<OpenSource />
			</main>
		</>
	);
}
