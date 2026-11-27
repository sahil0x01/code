import { splitRepo } from "./pr-source";

const MAX_PATHS = 20_000;
const SKILL = /^\.(?:agents|claude)\/skills\/(?:.*\/)?([^/]+)\/SKILL\.md$/;

export type FileList = {
	/** Folders end with `/`. */
	files: string[];
	/** Folder names of the repository's skills, usable as commands. */
	skills: string[];
	/** The repository has more paths than are listed. */
	partial: boolean;
};

export type FileClient = {
	git: {
		getTree(params: { owner: string; repo: string; tree_sha: string; recursive: "1" }): Promise<{
			data: { tree: { path?: string; type?: string }[]; truncated?: boolean };
		}>;
	};
};

export async function listFiles(client: FileClient, fullName: string, branch: string): Promise<FileList> {
	const { data } = await client.git.getTree({ ...splitRepo(fullName), tree_sha: branch, recursive: "1" });
	const paths = data.tree.flatMap(({ path, type }) => {
		if (!path || path.split("/").includes("node_modules")) return [];
		if (type === "blob") return [path];
		return type === "tree" ? [`${path}/`] : [];
	});
	const skills = paths.flatMap((path) => SKILL.exec(path)?.[1] ?? []);
	return {
		files: paths.slice(0, MAX_PATHS),
		skills: [...new Set(skills)],
		partial: Boolean(data.truncated) || paths.length > MAX_PATHS,
	};
}
