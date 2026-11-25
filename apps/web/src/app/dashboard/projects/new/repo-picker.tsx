"use client";

import { useActionState, useState } from "react";
import { importProjects, type ImportState } from "@/actions/projects";
import { buttonClass, field } from "@/components/ui/styles";
import type { InstallationRepo } from "@/server/github-repos";

type Props = {
	installationId: number;
	repos: InstallationRepo[];
	importedIds: number[];
};

const initialState: ImportState = { status: "idle" };

export function RepoPicker({ installationId, repos, importedIds }: Props) {
	const [state, formAction, pending] = useActionState(
		importProjects,
		initialState,
	);
	const imported = new Set(importedIds);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<number>>(new Set());

	const needle = query.trim().toLowerCase();
	const visible = repos.filter((repo) =>
		repo.fullName.toLowerCase().includes(needle),
	);

	function toggle(id: number) {
		setSelected((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	return (
		<form action={formAction} className="flex flex-col gap-4">
			<input type="hidden" name="installationId" value={installationId} />
			{/* Selected ids are sent from state, so repos hidden by the filter still count. */}
			{[...selected].map((id) => (
				<input key={id} type="hidden" name="repoId" value={id} />
			))}

			<div className="flex flex-wrap items-center gap-3">
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Filter repositories"
					aria-label="Filter repositories"
					autoComplete="off"
					className={`${field} w-full max-w-sm`}
				/>
				<span className="font-mono text-xs text-subtle">
					{visible.length === repos.length
						? `${repos.length} repositories`
						: `${visible.length} of ${repos.length}`}
				</span>
			</div>

			{visible.length === 0 ? (
				<p className="text-sm text-muted">No repositories match &ldquo;{query}&rdquo;.</p>
			) : (
				<ul className="flex flex-col gap-2">
					{visible.map((repo) => {
						const done = imported.has(repo.id);
						return (
							<li
								key={repo.id}
								className="pixel-inset bg-surface hover:bg-surface-2"
							>
								<label
									className={`flex items-start gap-3 px-4 py-3 ${
										done ? "opacity-60" : "cursor-pointer"
									}`}
								>
									<input
										type="checkbox"
										checked={done || selected.has(repo.id)}
										disabled={done}
										onChange={() => toggle(repo.id)}
										className="mt-1 size-4"
									/>
									<span className="min-w-0">
										<span className="block truncate font-medium">
											{repo.fullName}
										</span>
										<span className="block font-mono text-xs text-muted">
											{repo.isPrivate ? "Private" : "Public"} ·{" "}
											{repo.defaultBranch}
											{done ? " · already a project" : ""}
										</span>
									</span>
								</label>
							</li>
						);
					})}
				</ul>
			)}

			<div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-border bg-background px-5 py-3 md:-mx-10 md:px-10">
				<button
					type="submit"
					disabled={pending || selected.size === 0}
					className={buttonClass()}
				>
					{pending
						? "Importing..."
						: selected.size === 0
							? "Import"
							: `Import ${selected.size} ${selected.size === 1 ? "repository" : "repositories"}`}
				</button>
				{selected.size > 0 && (
					<button
						type="button"
						onClick={() => setSelected(new Set())}
						className="text-sm underline"
					>
						Clear selection
					</button>
				)}
				{state.status === "error" && (
					<p role="alert" className="text-sm text-red">
						{state.message}
					</p>
				)}
			</div>
		</form>
	);
}
