import type { RunLive } from "@nullfuse/db";
import { z } from "zod";

export type LiveRow = { status: string; live: RunLive | null };

export type LiveDeps = {
	getLive(userId: string, chatId: string, runId: string): Promise<LiveRow | null>;
	everyMs?: number;
	/** The stream closes after this long and the browser opens a new one. */
	maxMs?: number;
};

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done);
	});

/** Server-sent events with what a running run is writing: `live` when it changes, `done` at the end. */
export async function handleLive(
	deps: LiveDeps,
	input: { userId: string | undefined; chatId: string; runId: string; signal: AbortSignal },
) {
	const { userId, chatId, runId } = input;
	if (!userId) return new Response("Sign in again.", { status: 401 });
	const ids = z.tuple([z.uuid(), z.uuid()]).safeParse([chatId, runId]);
	const first = ids.success ? await deps.getLive(userId, chatId, runId) : null;
	if (!first) return new Response("Run not found.", { status: 404 });

	const closed = new AbortController();
	const signal = AbortSignal.any([input.signal, closed.signal]);
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: string, data: unknown) =>
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			const until = Date.now() + (deps.maxMs ?? 50_000);
			let row: LiveRow | null = first;
			let last = "";
			try {
				// Reconnect quickly when this stream ends.
				controller.enqueue(encoder.encode("retry: 1000\n\n"));
				while (!signal.aborted) {
					if (!row || (row.status !== "running" && row.status !== "queued")) {
						send("done", {});
						break;
					}
					const next = JSON.stringify(row.live);
					if (next !== last) {
						last = next;
						send("live", row.live);
					}
					if (Date.now() >= until) break;
					await sleep(deps.everyMs ?? 400, signal);
					if (!signal.aborted) row = await deps.getLive(userId, chatId, runId);
				}
			} catch (error) {
				console.error("live stream failed", error);
			}
			if (!closed.signal.aborted) controller.close();
		},
		cancel() {
			closed.abort();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
