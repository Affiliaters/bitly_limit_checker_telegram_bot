# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately using GitHub's **Security → Report a vulnerability** button on this repository. Include steps to reproduce and the impact.

You can expect a reply within a few days.

## Notes for bot owners

- Never commit your `BOT_TOKEN` or `WEBHOOK_SECRET`. Store them only in Cloudflare (Settings → Variables and Secrets).
- If your bot token is ever exposed, revoke it in [@BotFather](https://t.me/BotFather) with `/revoke`, add the new token in Cloudflare, and open `/setup` again.
- Set `WEBHOOK_SECRET` so only Telegram can send requests to your Worker.
