import { isOwnModelKey, ownModelKey } from "@nullfuse/models/providers";
import type { ComponentProps } from "react";
import { PixelIcon, type IconName } from "@/components/ui/pixel-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { MODELS, REASONING_OPTIONS } from "@/lib/chat";

type Align = ComponentProps<typeof Tooltip>["align"];

const control = "flex h-8 min-w-0 items-center gap-1.5 text-muted hover:bg-surface-2 hover:text-foreground";
const bare = "min-w-0 cursor-pointer truncate bg-transparent font-mono text-xs outline-none";

/** An on or off option: an icon that lights up, and names itself while on. */
export function Toggle({
	name,
	icon,
	label,
	hint,
	align,
}: {
	name: string;
	icon: IconName;
	label: string;
	hint: string;
	align?: Align;
}) {
	return (
		<Tooltip hint={hint} align={align}>
			<label
				className={`group/toggle ${control} cursor-pointer justify-center px-2 has-checked:pixel-flat has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:outline-dashed has-focus-visible:outline-ink active:scale-90`}
			>
				<input type="checkbox" name={name} aria-label={label} className="sr-only" />
				<PixelIcon name={icon} />
				<span aria-hidden="true" className="hidden font-mono text-xs group-has-checked/toggle:inline">
					{label}
				</span>
			</label>
		</Tooltip>
	);
}

/** A dropdown with an icon in front of it. */
export function Picker({
	icon,
	hint,
	align,
	children,
	...select
}: ComponentProps<"select"> & { icon: IconName; hint: string; align?: Align }) {
	return (
		<Tooltip hint={hint} align={align}>
			<label className={`${control} cursor-pointer pl-2`}>
				<PixelIcon name={icon} />
				<select {...select} className={`${bare} h-full pr-1`}>
					{children}
				</select>
			</label>
		</Tooltip>
	);
}

type Choice = { value: string; onChange(value: string): void };

export type OwnModelOption = { id: string; label: string };

export function ModelPicker({ value, onChange, own }: Choice & { own: OwnModelOption[] }) {
	// A removed model stays selected, so a message is never moved to another one unnoticed.
	const removed = isOwnModelKey(value) && !own.some((option) => ownModelKey(option.id) === value);
	return (
		<Picker
			icon="model"
			hint="Model that does the work"
			align="start"
			name="model"
			aria-label="Model"
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			{removed && <option value={value}>Removed model</option>}
			<optgroup label="Prefill">
				{MODELS.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</optgroup>
			{own.length > 0 && (
				<optgroup label="Your keys">
					{own.map((option) => (
						<option key={option.id} value={ownModelKey(option.id)}>
							{option.label}
						</option>
					))}
				</optgroup>
			)}
		</Picker>
	);
}

export function ReasoningPicker({ value, onChange }: Choice) {
	return (
		<Picker
			icon="think"
			hint="How hard it thinks. More costs more."
			name="reasoning"
			aria-label="Reasoning level"
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			{REASONING_OPTIONS.map((option) => (
				<option key={option.id} value={option.id}>
					{option.label}
				</option>
			))}
		</Picker>
	);
}

export function RunToggles() {
	return (
		<span className="flex items-center gap-1">
			<Toggle name="planOnly" icon="plan" label="Plan" hint="Plan first: nothing changes until you approve" />
			<Toggle name="verify" icon="tests" label="Tests" hint="Run the tests afterwards" />
		</span>
	);
}

/** The square button that sends or stops. */
export function IconButton({
	icon,
	label,
	hint,
	tone = "primary",
	...button
}: ComponentProps<"button"> & { icon: IconName; label: string; hint: string; tone?: "primary" | "secondary" }) {
	return (
		<Tooltip hint={hint} align="end">
			<button
				{...button}
				aria-label={label}
				className={`pixel pressable inline-flex size-8 items-center justify-center disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-subtle ${
					tone === "primary" ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground"
				}`}
			>
				<PixelIcon name={icon} />
			</button>
		</Tooltip>
	);
}
