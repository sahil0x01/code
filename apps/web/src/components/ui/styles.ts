// Shared class strings for the dashboard. Keep every full class name written
// out here (Tailwind finds classes by scanning source text, so they cannot be
// built from pieces).

const base =
	"pixel pressable inline-flex items-center justify-center font-medium disabled:cursor-not-allowed";

const variants = {
	primary:
		"bg-accent text-accent-foreground disabled:bg-surface-2 disabled:text-subtle",
	secondary: "bg-surface-2 text-foreground disabled:text-subtle",
	danger: "bg-red text-white disabled:opacity-60",
} as const;

const sizes = {
	md: "h-10.5 px-5 text-sm",
	sm: "h-8 px-3 text-sm",
} as const;

export function buttonClass(
	variant: keyof typeof variants = "primary",
	size: keyof typeof sizes = "md",
) {
	return `${base} ${sizes[size]} ${variants[variant]}`;
}

// Text inputs and selects.
export const field =
	"pixel-inset h-10.5 bg-surface px-3 text-sm focus:bg-background";
