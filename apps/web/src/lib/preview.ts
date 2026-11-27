export type PreviewView = {
	status: "none" | "starting" | "ready" | "failed" | "stopped";
	url: string | null;
	error: string | null;
	expiresAt: string | null;
};

type Row = {
	status: Exclude<PreviewView["status"], "none">;
	url: string | null;
	error: string | null;
	expiresAt: Date | null;
	updatedAt: Date;
};

const WORKER_SILENT_MS = 2 * 60_000;

/** What the page shows. A preview whose worker went quiet counts as stopped. */
export function previewView(row: Row | null, now = Date.now()): PreviewView {
	const empty = { url: null, error: null, expiresAt: null };
	if (!row) return { status: "none", ...empty };
	const live = row.status === "starting" || row.status === "ready";
	const expired = row.expiresAt !== null && row.expiresAt.getTime() <= now;
	if (live && (expired || now - row.updatedAt.getTime() > WORKER_SILENT_MS)) {
		return { status: "stopped", ...empty };
	}
	const url = row.status === "ready" && row.url?.startsWith("https://") ? row.url : null;
	return { status: row.status, url, error: row.error, expiresAt: row.expiresAt?.toISOString() ?? null };
}
