import type { Sandbox } from "@nullfuse/sandbox";
import { bashTool } from "./bash";
import { editTool } from "./edit";
import { createFileLock } from "./file-lock";
import { grepTool } from "./grep";
import { listTool } from "./list";
import { readTool } from "./read";
import { writeTool } from "./write";

export { bashTool, editTool, grepTool, listTool, readTool, writeTool };

export type ToolsOptions = {
	sandbox: Sandbox;
	/** Added to every command the bash tool runs. */
	env?: Record<string, string>;
	/** The model can look at an image a tool gives it. */
	images?: boolean;
};

export function createTools({ sandbox, env, images }: ToolsOptions) {
	const lock = createFileLock(sandbox.workdir);
	return {
		list: listTool(sandbox),
		read: readTool(sandbox, { images }),
		grep: grepTool(sandbox),
		edit: editTool(sandbox, lock),
		write: writeTool(sandbox, lock),
		bash: bashTool(sandbox, env),
	};
}

export type AgentTools = ReturnType<typeof createTools>;
