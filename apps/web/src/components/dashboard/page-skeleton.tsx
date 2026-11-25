export function PageSkeleton() {
	return (
		<div role="status" className="flex animate-pulse flex-col gap-6">
			<span className="sr-only">Loading</span>
			<div aria-hidden="true" className="h-8 w-48 bg-surface-2" />
			<div aria-hidden="true" className="flex flex-col gap-2">
				<div className="h-14 bg-surface" />
				<div className="h-14 bg-surface" />
				<div className="h-14 bg-surface" />
			</div>
		</div>
	);
}
