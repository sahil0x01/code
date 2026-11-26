/** A failure the model can see and recover from. Any other error fails the run. */
export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolError";
	}
}
