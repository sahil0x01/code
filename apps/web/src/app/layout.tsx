import type { Metadata, Viewport } from "next";
import { env } from "@/env";
import { site } from "@/lib/site";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
	title: {
		default: "NullFuse Code: an open-source cloud coding agent",
		template: "%s | NullFuse Code",
	},
	description: site.description,
	applicationName: site.name,
	openGraph: {
		type: "website",
		siteName: site.name,
		title: "NullFuse Code: an open-source cloud coding agent",
		description: site.description,
		url: "/",
	},
	twitter: {
		card: "summary_large_image",
	},
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
	],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
		>
			<body className="min-h-full flex flex-col">{children}</body>
		</html>
	);
}
