import Link from "next/link";
import { buttonClass } from "@/components/ui/styles";

type Action =
	| { label: string; href: string }
	| { label: string; disabled: true; note: string };

type Props = {
	title: string;
	description: string;
	action?: Action;
};

export function EmptyState({ title, description, action }: Props) {
	return (
		<section className="pixel-inset flex max-w-xl flex-col items-start gap-3 bg-surface p-6 md:p-8">
			<h2 className="text-lg font-semibold">{title}</h2>
			<p className="text-muted">{description}</p>
			{action && "href" in action ? (
				<Link href={action.href} className={buttonClass()}>
					{action.label}
				</Link>
			) : action ? (
				<div className="flex flex-col gap-1">
					<button type="button" disabled className={buttonClass()}>
						{action.label}
					</button>
					<span className="text-xs text-subtle">{action.note}</span>
				</div>
			) : null}
		</section>
	);
}
