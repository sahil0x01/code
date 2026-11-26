"use client";

import { type CSSProperties, Fragment, useEffect, useState } from "react";
import type { Token } from "@/lib/highlight";

export function CodeBlock({ language, code }: { language: string; code: string }) {
	const [done, setDone] = useState<{ code: string; lines: Token[][] }>();

	useEffect(() => {
		let current = true;
		import("@/lib/highlight")
			.then(({ highlightCode }) => highlightCode(language, code))
			.then((lines) => {
				if (current && lines) setDone({ code, lines });
			})
			.catch((error) => console.warn("highlighting failed", error));
		return () => {
			current = false;
		};
	}, [language, code]);

	return (
		<pre className="overflow-x-auto border border-border bg-surface p-3 font-mono text-xs leading-5">
			<code>
				{done?.code === code
					? done.lines.map((line, row) => (
							<Fragment key={row}>
								{line.map((token, index) => (
									<span
										key={index}
										className="text-(--shiki-light) dark:text-(--shiki-dark)"
										style={token.style as CSSProperties}
									>
										{token.text}
									</span>
								))}
								{"\n"}
							</Fragment>
						))
					: code}
			</code>
		</pre>
	);
}
