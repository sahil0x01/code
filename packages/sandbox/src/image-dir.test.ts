import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findImageDir } from "./image-dir";

const root = mkdtempSync(path.join(tmpdir(), "nf-image-dir-"));
const images = path.join(root, "packages", "sandbox", "image");
mkdirSync(images, { recursive: true });
writeFileSync(path.join(images, "Dockerfile"), "FROM scratch\n");

describe("findImageDir", () => {
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("uses the folder beside the source", () => {
		const found = findImageDir(import.meta.dirname);
		expect(existsSync(path.join(found, "recording", "Dockerfile"))).toBe(true);
	});

	it("searches the repository from a bundler's build folder", () => {
		expect(findImageDir(path.join(root, "apps", "worker", ".trigger", "tmp", "build-1"))).toBe(images);
	});

	it("says where it looked from when there is nothing", () => {
		expect(() => findImageDir(path.parse(root).root)).toThrow("Cannot find the sandbox image files");
	});
});
