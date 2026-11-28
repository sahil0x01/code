/** Roughly what an image or document costs, whatever the size of its bytes as text. */
const MEDIA_STAND_IN = "[file]".padEnd(6_000, " ");
const MEDIA_NOTE = "[file]";

const isFile = (value: object): value is { type: "file"; data: unknown } =>
	"type" in value && value.type === "file" && "data" in value;

function replace(value: unknown, standIn: string): unknown {
	if (value instanceof Uint8Array) return standIn;
	if (Array.isArray(value)) return value.map((item) => replace(item, standIn));
	if (value === null || typeof value !== "object") return value;
	if (isFile(value)) return { ...value, data: standIn };
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item, standIn)]));
}

/** For estimating size: a file counts as about 1,500 tokens. */
export const mediaForSize = (value: unknown) => replace(value, MEDIA_STAND_IN);

/** For writing out as text: the file's bytes are left out. */
export const mediaForText = (value: unknown) => replace(value, MEDIA_NOTE);
