import { getProjectForUser, listChats, listEnvVars } from "@nullfuse/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { removeEnvVar } from "@/actions/project-setup";
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonClass } from "@/components/ui/styles";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";
import { EnvVarForm } from "./env-var-form";
import { SetupForm } from "./setup-form";
import { ChatList } from "@/components/dashboard/chat-list";

export const metadata = { title: "Project setup" };

export default async function ProjectPage({
	params,
}: PageProps<"/dashboard/projects/[id]">) {
	const session = await requireSession();
	const { id } = await params;

	if (!z.uuid().safeParse(id).success) notFound();
	const project = await getProjectForUser(db, session.user.id, id);
	if (!project) notFound();

	const envVars = await listEnvVars(db, project.id);

	const chats = await listChats(db, session.user.id, {
		projectId: project.id,
		limit: 10,
	});

	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				crumb={{ href: "/dashboard/projects", label: "Projects" }}
				title={project.fullName}
				description={
					<>
						{project.isPrivate ? "Private" : "Public"} · {project.defaultBranch}
						{project.installationId === null ? " · disconnected" : ""}
					</>
				}
				actions={
					project.installationId !== null ? (
						<Link
							href={`/dashboard/chats/new?project=${project.id}`}
							className={buttonClass("secondary")}
						>
							New chat
						</Link>
					) : null
				}
			/>

			<section className="flex flex-col gap-3">
				<h2 className="font-semibold">Chats</h2>
				{chats.length > 0 ? (
					<ChatList chats={chats} showProject={false} />
				) : (
					<p className="text-sm text-subtle">No chats yet.</p>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="font-semibold">Setup commands</h2>
				<p className="max-w-xl text-sm text-muted">
					The agent runs these in a fresh sandbox before it starts work. Leave a
					field empty if the project does not need it.
				</p>
				<SetupForm
					projectId={project.id}
					installCommand={project.installCommand ?? ""}
					testCommand={project.testCommand ?? ""}
				/>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="font-semibold">Environment variables</h2>
				<p className="max-w-xl text-sm text-muted">
					Values are encrypted and never shown again. They are only handed to
					the sandbox while a run is working on this project. Saving an existing
					name replaces its value.
				</p>

				{envVars.length > 0 ? (
					<ul className="flex max-w-xl flex-col gap-2">
						{envVars.map((variable) => (
							<li
								key={variable.name}
								className="pixel-inset flex items-center justify-between gap-3 bg-surface p-3"
							>
								<span className="font-mono text-sm">
									{variable.name}
									<span className="text-subtle"> = ••••••••</span>
								</span>
								<form action={removeEnvVar}>
									<input type="hidden" name="projectId" value={project.id} />
									<input type="hidden" name="name" value={variable.name} />
									<button type="submit" className="text-sm underline">
										Remove
									</button>
								</form>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-subtle">No variables yet.</p>
				)}

				<EnvVarForm projectId={project.id} />
			</section>
		</div>
	);
}
