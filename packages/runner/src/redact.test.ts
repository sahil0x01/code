import { describe, expect, it } from "vitest";
import { redactor } from "./redact";

describe("redactor", () => {
	it("hides every occurrence of a secret", () => {
		const redact = redactor(["s3cr3t-value"]);
		expect(redact.text("key=s3cr3t-value and again s3cr3t-value")).toBe("key=[hidden] and again [hidden]");
	});

	it("hides the longer secret first when one contains another", () => {
		const redact = redactor(["token", "token-extended"]);
		expect(redact.text("a token-extended b token")).toBe("a [hidden] b [hidden]");
	});

	it("leaves text alone when there is nothing to hide, and ignores very short values", () => {
		expect(redactor([]).text("plain")).toBe("plain");
		expect(redactor(["ab", ""]).text("about abc")).toBe("about abc");
	});

	it("cleans a whole step: text, tool inputs (nested) and tool outputs", () => {
		const redact = redactor(["hunter2!!"]);
		const cleaned = redact.step({
			stepIndex: 0,
			finishReason: "tool-calls",
			text: "using hunter2!!",
			reasoning: "the key is hunter2!!",
			cachedInputTokens: 0,
			reasoningTokens: 0,
			toolCalls: [{ id: "1", name: "bash", input: { command: "echo hunter2!!", list: ["hunter2!!", 3] } }],
			toolResults: [{ id: "1", name: "bash", output: "hunter2!!\n", isError: false }],
			inputTokens: 1,
			outputTokens: 2,
		});
		expect(JSON.stringify(cleaned)).not.toContain("hunter2!!");
		expect(cleaned.toolCalls[0]?.input).toEqual({ command: "echo [hidden]", list: ["[hidden]", 3] });
		expect(cleaned).toMatchObject({ inputTokens: 1, outputTokens: 2, stepIndex: 0 });
	});
});
