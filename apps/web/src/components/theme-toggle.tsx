"use client";

const sun =
	"M4 0h1v1h-1z M1 1h1v1h-1z M7 1h1v1h-1z M3 2h3v1h-3z M2 3h5v1h-5z M0 4h1v1h-1z M2 4h5v1h-5z M8 4h1v1h-1z M2 5h5v1h-5z M3 6h3v1h-3z M1 7h1v1h-1z M7 7h1v1h-1z M4 8h1v1h-1z";
const moon =
	"M3 1h2v1h-2z M2 2h2v1h-2z M1 3h2v1h-2z M1 4h2v1h-2z M1 5h3v1h-3z M2 6h4v1h-4z M3 7h3v1h-3z";

function toggleTheme() {
	const root = document.documentElement;
	const next = root.dataset.theme === "dark" ? "light" : "dark";
	root.dataset.theme = next;
	try {
		localStorage.setItem("theme", next);
	} catch {
		// storage unavailable: the choice just won't be remembered
	}
}

export function ThemeToggle() {
	return (
		<button
			type="button"
			onClick={toggleTheme}
			aria-label="Switch between light and dark theme"
			className="pixel pressable inline-flex size-7 items-center justify-center bg-surface"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 9 9"
				shapeRendering="crispEdges"
				fill="currentColor"
				className="pop size-4 dark:hidden"
			>
				<path d={moon} />
			</svg>
			<svg
				aria-hidden="true"
				viewBox="0 0 9 9"
				shapeRendering="crispEdges"
				fill="currentColor"
				className="pop hidden size-4 dark:block"
			>
				<path d={sun} />
			</svg>
		</button>
	);
}
