import { AwsClient } from "aws4fetch";

export type R2Config = {
	accountId: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

type R2Env = Partial<
	Record<"R2_ACCOUNT_ID" | "R2_BUCKET" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY", string>
>;

/** The R2 settings from the environment, or null unless all four are set. */
export function r2ConfigFrom(source: R2Env): R2Config | null {
	const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = source;
	if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
	return {
		accountId: R2_ACCOUNT_ID,
		bucket: R2_BUCKET,
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY,
	};
}

export function recordingKey(input: { userId: string; chatId: string; runId: string; attempt: number }) {
	const user = input.userId.replaceAll(/[^A-Za-z0-9_-]/g, "_");
	return `recordings/${user}/${input.chatId}/${input.runId}-${input.attempt}.webm`;
}

/** A screenshot sits beside its run's video, so both are found and removed alike. */
export const screenshotKey = (video: string, number: number) => video.replace(/\.webm$/, `-${number}.png`);

export function createR2Store(config: R2Config) {
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto",
	});
	const base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;

	// A link that allows one method on one object until it expires, with no keys in it.
	const presign = async (method: "GET" | "PUT", key: string, seconds: number) => {
		const url = new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);
		url.searchParams.set("X-Amz-Expires", String(seconds));
		const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } });
		return signed.url;
	};

	return {
		uploadUrl: (key: string, seconds = 600) => presign("PUT", key, seconds),
		downloadUrl: (key: string, seconds = 300) => presign("GET", key, seconds),
		async remove(key: string) {
			const url = await presign("GET", key, 60);
			const response = await client.fetch(url.split("?")[0] ?? url, { method: "DELETE" });
			if (!response.ok) throw new Error(`Could not delete the recording: ${response.status}`);
		},
	};
}

export type RecordingStore = ReturnType<typeof createR2Store>;
