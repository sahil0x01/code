import Link from "next/link";

export function Logo({
	href = "/",
	tagline = true,
}: {
	href?: string;
	tagline?: boolean;
}) {
	return (
		<Link href={href} className="inline-flex items-center gap-2.5">
			<span
				aria-hidden="true"
				className="pixel-flat dither size-4.5 bg-background"
			/>
			<span className="text-[17px] font-bold tracking-tight">code</span>
			{tagline && (
				<span className="font-mono text-xs text-muted">by prefill</span>
			)}
		</Link>
	);
}
