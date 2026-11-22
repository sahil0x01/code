export default function Home() {
	return (
		<main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
			<h1 className="text-5xl font-semibold tracking-tighter">NullFuse Code</h1>

			<p className="text-muted">
				Body text in Geist Sans. Code and labels in Geist Mono.
			</p>

			<div className="pixel bg-surface p-6 [--drop:6px]">
				<h2 className="text-xl font-semibold tracking-tight">A card</h2>
				<p className="mt-2 text-muted">Chipped corners, hard drop shadow.</p>
				<code className="pixel-inset mt-4 block bg-background p-2 font-mono text-sm">
					pnpm db:up
				</code>
			</div>

			<div className="flex flex-wrap gap-3">
				<button
					type="button"
					className="pixel pressable h-10 bg-accent px-5 font-medium text-accent-foreground"
				>
					Start a run
				</button>
				<button
					type="button"
					className="pixel pressable h-10 bg-surface px-5 font-medium"
				>
					Host it yourself
				</button>
			</div>

			<div className="flex flex-wrap gap-3 font-mono text-xs uppercase">
				<span className="pixel-flat bg-green px-2 py-1">succeeded</span>
				<span className="pixel-flat bg-blue px-2 py-1 text-white">running</span>
				<span className="pixel-flat bg-red px-2 py-1 text-white">failed</span>
			</div>
		</main>
	);
}
