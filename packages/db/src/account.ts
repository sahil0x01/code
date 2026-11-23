import { eq } from "drizzle-orm";
import type { Db } from "./index";
import { account, session, user, waitlist } from "./schema";

export async function exportAccountData(db: Db, userId: string) {
	const [profile] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			createdAt: user.createdAt,
		})
		.from(user)
		.where(eq(user.id, userId));

	if (!profile) return null;

	const logins = await db
		.select({
			provider: account.providerId,
			providerAccountId: account.accountId,
			scope: account.scope,
			createdAt: account.createdAt,
		})
		.from(account)
		.where(eq(account.userId, userId));

	const sessions = await db
		.select({
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
		})
		.from(session)
		.where(eq(session.userId, userId));

	const waitlistEntries = await db
		.select({ email: waitlist.email, createdAt: waitlist.createdAt })
		.from(waitlist)
		.where(eq(waitlist.email, profile.email));

	return {
		exportedAt: new Date().toISOString(),
		profile,
		logins,
		sessions,
		waitlist: waitlistEntries,
	};
}

export async function deleteWaitlistEntry(db: Db, email: string) {
	await db.delete(waitlist).where(eq(waitlist.email, email));
}
