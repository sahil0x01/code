"use client";

import { PROVIDERS, type ProviderId, SMALL_CONTEXT_TOKENS } from "@nullfuse/models/providers";
import { useActionState, useId, useState } from "react";
import { addModel, type ModelState, removeModel, testModel } from "@/actions/models";
import { buttonClass, field } from "@/components/ui/styles";
import { SettingsSection } from "./section";

export type SavedModel = {
	id: string;
	provider: ProviderId;
	modelId: string;
	label: string;
	baseUrl: string | null;
	keyLast4: string;
	contextTokens: number | null;
	hasPrice: boolean;
	maxRunTokens: number | null;
};

const idle: ModelState = { status: "idle" };
const caption = "font-mono text-xs uppercase text-subtle";

function Message({ state, done }: { state: ModelState; done: string }) {
	if (state.status === "success") return <output className="text-sm text-green">{done}</output>;
	if (state.status !== "error") return null;
	return (
		<p role="alert" className="break-words text-sm text-red">
			{state.message}
		</p>
	);
}

function Saved({ model }: { model: SavedModel }) {
	const [state, formAction, pending] = useActionState(testModel, idle);
	const provider = PROVIDERS.find((p) => p.id === model.provider)?.label ?? model.provider;

	return (
		<li className="flex flex-col gap-2 border-t border-border pt-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate font-medium">{model.label}</p>
					<p className="break-all font-mono text-xs text-muted">
						{provider} · {model.modelId} · key ending {model.keyLast4}
						{model.baseUrl && ` · ${model.baseUrl}`}
					</p>
				</div>
				<div className="flex gap-3">
					<form action={formAction}>
						<input type="hidden" name="id" value={model.id} />
						<button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
							{pending ? "Testing..." : "Test"}
						</button>
					</form>
					<form
						action={removeModel}
						onSubmit={(event) => {
							if (!window.confirm(`Remove ${model.label} and its key?`)) event.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={model.id} />
						<button type="submit" className={buttonClass("secondary", "sm")}>
							Remove
						</button>
					</form>
				</div>
			</div>
			<ul className="text-xs text-muted">
				{!model.hasPrice && <li>Price unknown: runs show token counts, and the dollar limit does not apply.</li>}
				{model.contextTokens !== null && model.contextTokens < SMALL_CONTEXT_TOKENS && (
					<li>Small context window: long chats may fail.</li>
				)}
				{model.maxRunTokens !== null && <li>Limit: {model.maxRunTokens.toLocaleString("en")} tokens per run.</li>}
			</ul>
			<Message state={state} done="It works." />
		</li>
	);
}

function AddModel({ suggestions }: { suggestions: Partial<Record<ProviderId, string[]>> }) {
	// Controlled, so a failed test does not clear what was typed.
	const empty = { modelId: "", label: "", apiKey: "", baseUrl: "", maxRunTokens: "" };
	const [provider, setProvider] = useState<ProviderId>("openai");
	const [values, setValues] = useState(empty);
	const [state, formAction, pending] = useActionState(async (previous: ModelState, formData: FormData) => {
		const result = await addModel(previous, formData);
		if (result.status === "success") setValues(empty);
		return result;
	}, idle);
	const id = useId();

	const input = (name: keyof typeof empty, label: string, props: React.ComponentProps<"input">) => (
		<label className="flex flex-col gap-2">
			<span className={caption}>{label}</span>
			<input
				{...props}
				name={name}
				value={values[name]}
				onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
				autoComplete="off"
				spellCheck={false}
				className={`${field} font-mono`}
			/>
		</label>
	);

	return (
		<form action={formAction} className="flex flex-col gap-3 border-t border-border pt-4">
			<label className="flex flex-col gap-2">
				<span className={caption}>Provider</span>
				<select
					name="provider"
					value={provider}
					onChange={(event) => setProvider(event.target.value as ProviderId)}
					className={field}
				>
					{PROVIDERS.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</select>
			</label>
			{provider === "openai-compatible" &&
				input("baseUrl", "Address", { type: "url", required: true, placeholder: "https://openrouter.ai/api/v1" })}
			{provider === "openai-compatible" && (
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" name="readsImages" className="size-4 accent-accent" />
					This model can read images
				</label>
			)}
			{input("modelId", "Model ID", { required: true, maxLength: 200, list: id, placeholder: "As your provider names it" })}
			<datalist id={id}>
				{suggestions[provider]?.map((name) => (
					<option key={name} value={name} />
				))}
			</datalist>
			{input("apiKey", "API key", { type: "password", required: true, minLength: 8, maxLength: 500 })}
			{input("label", "Name (optional)", { maxLength: 60, placeholder: "Shown in the model list" })}
			{input("maxRunTokens", "Token limit per run (optional)", { type: "number", min: 10_000, step: 1 })}
			<div className="flex flex-wrap items-center gap-3">
				<button type="submit" disabled={pending} className={buttonClass()}>
					{pending ? "Testing..." : "Test and save"}
				</button>
				<Message state={state} done="Saved." />
			</div>
		</form>
	);
}

export function ModelsSection({
	models,
	suggestions,
}: {
	models: SavedModel[];
	suggestions: Partial<Record<ProviderId, string[]>>;
}) {
	return (
		<SettingsSection
			title="Your models"
			description="Use your own API key. Your provider bills you for the model, and your code and messages are sent to it. Testing makes one small request on your key."
		>
			{models.length > 0 && (
				<ul className="flex flex-col gap-3">
					{models.map((model) => (
						<Saved key={model.id} model={model} />
					))}
				</ul>
			)}
			<AddModel suggestions={suggestions} />
		</SettingsSection>
	);
}
