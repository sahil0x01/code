import path from "node:path";

export type FileLock = <T>(file: string, work: () => Promise<T>) => Promise<T>;

/**
 * The model can call several tools at once. Changes to one file take turns, so a later
 * one reads what the earlier one wrote and does not overwrite it.
 */
export function createFileLock(workdir: string): FileLock {
	const queues = new Map<string, Promise<unknown>>();

	return <T>(file: string, work: () => Promise<T>) => {
		const key = path.posix.resolve(workdir, file);
		const result = (queues.get(key) ?? Promise.resolve()).then(work);
		// A failed change must not block the ones after it.
		queues.set(
			key,
			result.catch(() => {}),
		);
		return result;
	};
}
