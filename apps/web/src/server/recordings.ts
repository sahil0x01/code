import "server-only";
import { createR2Store, r2ConfigFrom } from "@nullfuse/storage";
import { env } from "@/env";

export function recordingStore() {
	const config = r2ConfigFrom(env);
	return config && createR2Store(config);
}
