import type { ReactNode } from "react";

type LegalPageProps = {
	title: string;
	updated?: string;
	children: ReactNode;
};

export function LegalPage({ title, updated, children }: LegalPageProps) {
	return (
		<article className="flex flex-col gap-3">
			<h1 className="text-[clamp(32px,5vw,48px)] font-semibold leading-[1.1] tracking-tighter">
				{title}
			</h1>
			{updated && (
				<p className="font-mono text-xs text-subtle">Last updated: {updated}</p>
			)}
			<div className="mt-4 flex flex-col gap-4 leading-relaxed [&_a]:underline [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-6">
				{children}
			</div>
		</article>
	);
}
