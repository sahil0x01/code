import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";

const components: Components = {
	h1: ({ children }) => <h3 className="text-lg font-semibold">{children}</h3>,
	h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
	h3: ({ children }) => <h4 className="font-semibold">{children}</h4>,
	h4: ({ children }) => <h4 className="font-semibold">{children}</h4>,
	ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>,
	ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
	a: ({ href, children }) => (
		<a href={href} target="_blank" rel="noreferrer" className="underline">
			{children}
		</a>
	),
	// A remote image in a reply could report who is reading it, so only its text is shown.
	img: ({ alt }) => <span className="text-muted">[image: {alt}]</span>,
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 border-border pl-3 text-muted">{children}</blockquote>
	),
	table: ({ children }) => (
		<div className="relative overflow-x-auto">
			<table className="border-collapse text-sm">{children}</table>
		</div>
	),
	th: ({ children }) => <th className="border border-border px-2 py-1 text-left">{children}</th>,
	td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
	pre: ({ children }) => <>{children}</>,
	code: ({ className, children }) => {
		const text = String(children ?? "");
		const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
		// Fenced code keeps its trailing newline; inline code has none.
		if (language || text.includes("\n")) {
			return <CodeBlock language={language ?? ""} code={text.replace(/\n$/, "")} />;
		}
		return <code className="bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
	},
};

export function Markdown({ text }: { text: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-3 break-words text-[15px] leading-relaxed">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{text}
			</ReactMarkdown>
		</div>
	);
}
