import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./index";
import { attachment, chat, message } from "./schema";

export type NewAttachment = { name: string; mediaType: string; data: Buffer };

const summary = {
	id: attachment.id,
	messageId: attachment.messageId,
	name: attachment.name,
	mediaType: attachment.mediaType,
	size: attachment.size,
};

/** What was sent in one of the user's chats, without the contents. */
export function listAttachments(db: Db, userId: string, chatId: string) {
	return db
		.select(summary)
		.from(attachment)
		.innerJoin(message, eq(attachment.messageId, message.id))
		.innerJoin(chat, eq(message.chatId, chat.id))
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
		.orderBy(asc(attachment.messageId), asc(attachment.position));
}

/** One file with its contents, only for the chat's owner. */
export async function getAttachment(db: Db, userId: string, id: string) {
	const [row] = await db
		.select({ name: attachment.name, mediaType: attachment.mediaType, data: attachment.data })
		.from(attachment)
		.innerJoin(message, eq(attachment.messageId, message.id))
		.innerJoin(chat, eq(message.chatId, chat.id))
		.where(and(eq(attachment.id, id), eq(chat.userId, userId)));
	return row ?? null;
}

/** For the worker: the contents of the files sent with these messages. */
export function loadAttachments(db: Db, messageIds: string[]) {
	if (messageIds.length === 0) return Promise.resolve([]);
	return db
		.select({
			messageId: attachment.messageId,
			name: attachment.name,
			mediaType: attachment.mediaType,
			data: attachment.data,
		})
		.from(attachment)
		.where(inArray(attachment.messageId, messageIds))
		.orderBy(asc(attachment.messageId), asc(attachment.position));
}
