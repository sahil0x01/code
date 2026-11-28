# Merging

**Merge** on a chat's pull request bar, or `/merge` in the chat, checks the pull request first. The app
does this, not the model.

| What it finds | What happens |
|---|---|
| Checks pass, no conflicts | Merges at once |
| Checks still running | Waits, then merges if they pass |
| Branch behind base, and a rule requires it up to date | Updates it without the model, waits, merges |
| Merge conflicts or failed checks | A run fixes them, then you are asked to review and merge again |
| Still failing after 2 fix runs, or a run that fails or is stopped | Stops and says why |
| A draft, a branch rule such as a required review, or unreadable checks | Stops and says why |

- Only the commit you approved is merged. After the agent changes code, you merge again. The one exception
  is an update that only merges the base branch in.
- A commit pushed by someone else while the merge waits stops it.
- `/merge` approves the latest commit. It counts only as the whole message.
- **Merge anyway** skips the checks and merges at once, when GitHub allows it.
- Review comments are never sent by a merge. The button says how many there are, so you can send them.
- Sending a message or pressing **Cancel merge** calls the merge off. A merge also gives up after two hours.
- Fix runs use the chat's last model and thinking level, with the usual limit on each run's cost.
- A fix is asked of at most 3 failed checks. Cancelled checks and commit statuses can't be sent.

There are no separate buttons to update a branch or fix a check: a merge does both when needed.

Once the pull request is merged, the chat takes no more messages. Start a new chat.

## Setup

Nothing new in the GitHub App, and no public address. The worker looks at waiting merges every minute,
so run the database migrations and start or deploy the worker.

## What to know

- CI logs reach the agent without anyone reading them first. Its changes are shown to you before any
  merge, but keep the sandbox network restricted ([sandbox-network.md](sandbox-network.md)).
- When a waiting merge stops, the chat is marked unread. A merge that succeeds later marks it done.
  Neither shows a notification of its own; a finished fix run does.
