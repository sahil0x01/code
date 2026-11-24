"use client";

import { useActionState } from "react";
import { importProjects, type ImportState } from "@/actions/projects";
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
	const allImported = repos.every((repo) => imported.has(repo.id));

	return (
		<form action={formAction} className="flex max-w-xl flex-col gap-4">
			<input type="hidden" name="installationId" value={installationId} />

			<ul className="flex flex-col gap-2">
				{repos.map((repo) => {
					const done = imported.has(repo.id);
					return (
						<li key={repo.id} className="pixel-inset bg-surface">
							<label className="flex items-start gap-3 p-3">
								<input
									type="checkbox"
									name="repoId"
									value={repo.id}
									disabled={done}
									defaultChecked={done}
									className="mt-1"
								/>
								<span>
									<span className="block font-semibold">{repo.fullName}</span>
									<span className="block text-sm text-muted">
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

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={pending || allImported}
					className="pixel pressable h-10.5 bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-60"
				>
					{pending ? "Importing..." : "Import selected"}
				</button>
				{state.status === "error" && (
					<p role="alert" className="text-sm text-red">
						{state.message}
					</p>
				)}
			</div>
		</form>
	);
}
