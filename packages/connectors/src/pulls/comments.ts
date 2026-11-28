import { MAX_MESSAGE_LENGTH } from "../limits";
import { visibleText } from "./visible-text";

export type PullComment = {
	/** Unique across the three kinds of comment. */
	key: string;
	author: string;
	body: string;
	/** The file and line, for a comment left on the diff. */
	where: string | null;
	url: string;
	updatedAt: string;
	createdAt: string;
	/** An approving review, which asks for nothing. */
	approval: boolean;
};

export type CommentsResponse = { comments: PullComment[] };

const MAX_BODY_CHARS = 4000;

/** The follow-up that asks the agent to deal with the comments. */
export function commentsMessage(comments: PullComment[]) {
	const blocks = comments.map((comment) => {
		const body = visibleText(comment.body);
		const short = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}...` : body;
		return `${comment.author}${comment.where ? ` on ${comment.where}` : ""}:\n${short}`;
	});
	const text = ["Address these review comments on the pull request.", ...blocks].join("\n\n");
	return text.slice(0, MAX_MESSAGE_LENGTH);
}
