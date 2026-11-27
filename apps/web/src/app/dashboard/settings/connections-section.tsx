"use client";

import { useActionState, useState } from "react";
import {
	chooseProject,
	type ConnectionState,
	disconnect,
	startTelegramLink,
	type TelegramState,
} from "@/actions/connections";
import { buttonClass, field } from "@/components/ui/styles";
import { SettingsSection } from "./section";

export type LinkedAccount = {
	id: string;
	provider: "slack" | "discord" | "telegram";
	name: string;
	projectId: string | null;
};

type Project = { id: string; fullName: string };

const LABELS = { slack: "Slack", discord: "Discord", telegram: "Telegram" };

const HOW = {
	slack: "Tag the app with your task, or send /prefill and your task.",
	discord: "Send /prefill and your task.",
	telegram: "Send the bot your task, or tag it in a group.",
};

const idle: ConnectionState = { status: "idle" };

function Linked({ link, projects }: { link: LinkedAccount; projects: Project[] }) {
	const [state, formAction, pending] = useActionState(chooseProject, idle);
	const [projectId, setProjectId] = useState(link.projectId ?? "");
	const title = `${LABELS[link.provider]}: ${link.name}`;

	return (
		<li className="flex flex-col gap-3 border-t border-border pt-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate font-medium">{title}</p>
					<p className="text-xs text-muted">{HOW[link.provider]}</p>
				</div>
				<form
					action={disconnect}
					onSubmit={(event) => {
						if (!window.confirm(`Disconnect ${title}?`)) event.preventDefault();
					}}
				>
					<input type="hidden" name="id" value={link.id} />
					<button type="submit" className={buttonClass("secondary", "sm")}>
						Disconnect
					</button>
				</form>
			</div>
			<form action={formAction} className="flex flex-col gap-2">
				<input type="hidden" name="id" value={link.id} />
				<label className="flex flex-col gap-2">
					<span className="font-mono text-xs uppercase text-subtle">Project for tasks</span>
					<select
						name="projectId"
						required
						value={projectId}
						onChange={(event) => setProjectId(event.target.value)}
						className={field}
					>
						<option value="" disabled>
							Choose a project
						</option>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.fullName}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap items-center gap-3">
					<button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
						{pending ? "Saving..." : "Save"}
					</button>
					{state.status === "success" && <output className="text-sm text-green">Saved.</output>}
					{state.status === "error" && (
						<p role="alert" className="text-sm text-red">
							{state.message}
						</p>
					)}
				</div>
				{!link.projectId && <p className="text-sm text-muted">Choose a project before sending tasks.</p>}
			</form>
		</li>
	);
}

function ConnectTelegram() {
	const [state, formAction, pending] = useActionState<TelegramState>(startTelegramLink, { status: "idle" });

	if (state.status === "ready") {
		return (
			<a href={state.url} target="_blank" rel="noreferrer" className={`${buttonClass()} w-fit`}>
				Open Telegram and press Start
			</a>
		);
	}
	return (
		<form action={formAction} className="flex flex-wrap items-center gap-3">
			<button type="submit" disabled={pending} className={buttonClass("secondary")}>
				Connect Telegram
			</button>
			{state.status === "error" && (
				<p role="alert" className="text-sm text-red">
					{state.message}
				</p>
			)}
		</form>
	);
}

export function ConnectionsSection({
	links,
	projects,
	available,
	githubHandle,
	result,
}: {
	links: LinkedAccount[];
	projects: Project[];
	available: { slack: boolean; discord: boolean; telegram: boolean };
	githubHandle: string;
	result: "connected" | "failed" | null;
}) {
	const chatApps = available.slack || available.discord || available.telegram;

	return (
		<div id="connections">
			<SettingsSection
				title="Connections"
				description="Send tasks from other tools. Results and pull request links come back there, with the agent's summary of your code."
			>
				{result === "connected" && <output className="text-sm text-green">Connected.</output>}
				{result === "failed" && (
					<p role="alert" className="text-sm text-red">
						Nothing was connected. Try again.
					</p>
				)}
				<div className="flex flex-col gap-1">
					<p className="font-medium">GitHub</p>
					<p className="text-sm text-muted">
						Nothing to connect. On a connected repository, tag <code className="font-mono">@{githubHandle}</code> or
						write <code className="font-mono">/prefill</code> with your task in a new issue, in a comment on an issue,
						or on a pull request a chat opened.
					</p>
				</div>
				{links.length > 0 && (
					<ul className="flex flex-col gap-3">
						{links.map((link) => (
							<Linked key={link.id} link={link} projects={projects} />
						))}
					</ul>
				)}
				{chatApps && (
					<div className="flex flex-wrap items-start gap-3 border-t border-border pt-4">
						{(["slack", "discord"] as const)
							.filter((provider) => available[provider])
							.map((provider) => (
								<a
									key={provider}
									href={`/api/connectors/${provider}/install`}
									className={`${buttonClass("secondary")} w-fit`}
								>
									Connect {LABELS[provider]}
								</a>
							))}
						{available.telegram && <ConnectTelegram />}
					</div>
				)}
			</SettingsSection>
		</div>
	);
}
