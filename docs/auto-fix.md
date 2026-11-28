# Auto-fix

Turn on **Auto-fix** on a chat's pull request bar. The worker then looks at the pull request every two
minutes while the chat is idle, and starts a run for:

| What | Which |
|---|---|
| Merge conflicts | Merges the base branch and resolves them. Once for the same two commits |
| Failed checks | Check runs that `failure`d or `timed_out`, after no check is still running. Up to 3 a run |
| Comments | New since auto-fix was turned on, by people with write access, two minutes after the last one. Up to 5 a run |

Cancelled checks, checks waiting for approval, commit statuses, approving reviews, bots and hidden text
are left out. Each check, comment or conflict is sent once, also when its run fails.

## Limits

| Setting (worker) | Default | Meaning |
|---|---|---|
| `AUTOFIX_MAX_RUNS` | 3 | Automatic runs in a row. A message from you starts the count again |
| `AUTOFIX_MAX_COST_USD` | 2 | Model and sandbox spend of automatic runs. Turning auto-fix off and on starts it again |

A run that starts under the budget can end above it, by at most what one run may cost. Stopping or
cancelling an automatic run turns auto-fix off, as does a merged or closed pull request. Automatic runs
use the chat's last model and thinking level.

## Setup

Nothing new in the GitHub App, and no public address: the worker asks GitHub. It needs the permissions
that already show checks in the app (Checks, Commit statuses and Actions: read). Run the database
migrations and start or deploy the worker.

## What to know

- CI logs reach the agent without anyone reading them first. A log can hold text from a dependency or an
  outside service that tries to steer the agent. Keep the sandbox network restricted
  ([sandbox-network.md](sandbox-network.md)).
- A check that also fails on the base branch is still sent, and the agent may not be able to fix it.
- The agent does not answer comment threads on GitHub. Its reply is in the chat.
- Each pass makes several GitHub requests per chat with auto-fix on, and looks at 50 chats at most.

## Not built

Webhooks that start a pass at once, and a default setting per project.
