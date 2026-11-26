import type { Sandbox } from "@nullfuse/sandbox";
import { bashTool } from "./bash";
import { editTool } from "./edit";
import { grepTool } from "./grep";
import { listTool } from "./list";
import { readTool } from "./read";
import { writeTool } from "./write";

export { bashTool, editTool, grepTool, listTool, readTool, writeTool };

export type ToolsOptions = {
	sandbox: Sandbox;
	/** Added to every command the bash tool runs. */
	env?: Record<string, string>;
};

export function createTools({ sandbox, env }: ToolsOptions) {
	return {
		list: listTool(sandbox),
		read: readTool(sandbox),
		grep: grepTool(sandbox),
		edit: editTool(sandbox),
		write: writeTool(sandbox),
		bash: bashTool(sandbox, env),
	};
}

export type AgentTools = ReturnType<typeof createTools>;
