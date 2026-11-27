# Connectors

Tag the app, or send it a task, from GitHub, Slack, Discord or Telegram. It becomes a chat, and the result and pull request
link are sent back to the same tool.

Every tool needs a public https address. For local work use a tunnel and set `NEXT_PUBLIC_APP_URL` to it.
Run the database migrations, and set `APP_URL` for the worker so replies link to the chat. A chat app
appears under Settings once all its web values are set.

## How they all behave

- Only a person whose account is linked can start a run.
- Tasks use the default model and thinking level, on the project's default branch. Start a task with
  `/plan` to plan first.
- A reply is tried up to five times. The worker's one-minute sweep retries it and covers cancelled runs.
- Disconnecting under Settings stops new tasks and unsent replies.

## GitHub

No new app: the GitHub App you already have does it.

1. In the app's settings give **Issues: Read and write** and subscribe to the **Issues** and
   **Issue comment** events.
   Accept the new permission on each installation.
2. Set the webhook URL to `https://YOUR_ADDRESS/api/webhooks/github`.

Write `@your-app-slug` or `/prefill`, with any task, in the description of a new issue or in a comment
on an issue to start a chat, or in a comment on a pull request a chat opened to continue it. It must be
new, and written by someone who signed in to Prefill, connected the repository and has **write access**
to it, checked with GitHub when the tag arrives. Bots, quotes and code blocks are ignored. The agent
gets an issue's title and body only when its author also has write access. Otherwise a comment has to
say what to do. The app reacts with eyes, then comments when the run finishes. On a public repository that
comment is public.

## Slack

1. At https://api.slack.com/apps choose **Create New App**, **From a manifest**, and paste this:

```yaml
display_information:
  name: Prefill Code
features:
  bot_user:
    display_name: Prefill Code
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: true
  slash_commands:
    - command: /prefill
      url: https://YOUR_ADDRESS/api/webhooks/slack/command
      description: Send a coding task
      usage_hint: fix the broken link in the footer
settings:
  event_subscriptions:
    request_url: https://YOUR_ADDRESS/api/webhooks/slack/events
    bot_events:
      - app_mention
oauth_config:
  redirect_urls:
    - https://YOUR_ADDRESS/api/connectors/slack/callback
  scopes:
    bot:
      - commands
      - app_mentions:read
      - chat:write
```

2. Web: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (from Basic Information).
3. For other workspaces, turn on **Manage Distribution**.
4. Invite the app to a channel (`/invite @Prefill Code`), then tag it with any task. Only you see its
   answer there, and the result comes as a direct message. Earlier messages in the thread are not read.

## Discord

Tasks are sent with `/prefill`. Tagging the bot does nothing: Discord delivers ordinary messages only
to a program that stays connected to it, which this app does not run.

1. Create an application at https://discord.com/developers/applications and add a bot.
2. Web: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`.
   Worker: `DISCORD_BOT_TOKEN`.
3. Under OAuth2 add the redirect `https://YOUR_ADDRESS/api/connectors/discord/callback`.
4. Deploy the web app, then set **Interactions Endpoint URL** to
   `https://YOUR_ADDRESS/api/webhooks/discord`.
5. Register the command once:

```bash
curl -X POST "https://discord.com/api/v10/applications/$DISCORD_APPLICATION_ID/commands" -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H "Content-Type: application/json" -d '{"name":"prefill","description":"Send a coding task","options":[{"type":3,"name":"task","description":"What to do","required":true}]}'
```

6. Invite the app to a server with the `bot` and `applications.commands` scopes. Results arrive as a
   direct message, so the person must share a server with the bot and allow messages from its members.

## Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather).
2. Web: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (16 or more letters,
   digits, `_` or `-`). Worker: `TELEGRAM_BOT_TOKEN`.
3. Point the bot at your server:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://YOUR_ADDRESS/api/webhooks/telegram" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message"]'
```

Choosing **Connect Telegram** makes a link that works once, for ten minutes. The bot names the account
it linked to, and `/unlink` removes the link.

In a group, `/prefill@your_bot fix this` works at once. To use a plain tag, `@your_bot fix this`, turn
the bot's privacy mode off with `/setprivacy` in BotFather, then add the bot to the group again. It then
receives every group message and ignores those that do not tag it. Results go to your private chat.

## Not built

- **Signal** has no official bot service. It would need a phone number and an unofficial program running
  all the time.
- **WhatsApp** needs a verified Meta business, and a message sent more than 24 hours after the person's
  last one must use an approved template.
- Replying inside a chat app to continue a chat, and choosing a project or model per message.
