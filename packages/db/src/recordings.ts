import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "./index";
import { recordingDeletion, run } from "./schema";

export const RECORDING_RETENTION_DAYS = 30;

/** For a video that was uploaded but never saved on a run. */
export async function queueRecordingDeletion(db: Db, key: string) {
	await db.insert(recordingDeletion).values({ key }).onConflictDoNothing();
}

/** Marks old videos as deleted. The trigger then queues their files. Returns how many. */
export async function expireRecordings(db: Db, days = RECORDING_RETENTION_DAYS) {
	const rows = await db
		.update(run)
		.set({
			recording: {
				status: "skipped",
				message: `This video was deleted after ${days} days.`,
				detail: "",
			},
		})
		.where(
			and(
				ne(run.status, "running"),
				sql`${run.recording}->>'status' = 'recorded'`,
				sql`coalesce(${run.finishedAt}, ${run.createdAt}) < now() - make_interval(days => ${days}::int)`,
			),
		)
		.returning({ id: run.id });
	return rows.length;
}

/**
 * Removes queued files. One that fails stays queued and goes behind the others, so it
 * cannot hold them up.
 */
export async function deleteQueuedRecordings(
	db: Db,
	remove: (key: string) => Promise<void>,
	limit = 100,
) {
	const queued = await db
		.select({ key: recordingDeletion.key })
		.from(recordingDeletion)
		.orderBy(asc(recordingDeletion.attempts), asc(recordingDeletion.createdAt))
		.limit(limit);

	const done: string[] = [];
	const failed: { key: string; error: string }[] = [];
	for (const { key } of queued) {
		try {
			await remove(key);
			done.push(key);
		} catch (error) {
			failed.push({ key, error: error instanceof Error ? error.message : String(error) });
			await db
				.update(recordingDeletion)
				.set({ attempts: sql`${recordingDeletion.attempts} + 1` })
				.where(eq(recordingDeletion.key, key));
		}
	}
	if (done.length > 0) {
		await db.delete(recordingDeletion).where(inArray(recordingDeletion.key, done));
	}
	return { deleted: done.length, failed };
}
