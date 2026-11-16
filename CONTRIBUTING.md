# Contributing

Thanks for helping improve the Bitly Limit Checker Bot! 🎉

## Ways to help
- 🐛 **Report a bug:** open an [issue](https://github.com/Affiliaters/bitly_limit_checker_telegram_bot/issues) with steps to reproduce.
- 💡 **Suggest a feature:** open an issue describing the idea.
- 🔧 **Send code:** open a pull request.

## Making a change
1. Fork the repo and create a branch: `git checkout -b my-feature`
2. Make your change in `src/index.js` (the whole bot is in this one file).
3. Test it on your own bot:
   ```bash
   npm install
   cp .dev.vars.example .dev.vars   # fill in your test bot token
   npx wrangler dev
   ```
   Or deploy to your own Cloudflare account and open `/setup`.
4. If you add a setting, also add it to `.dev.vars.example`, `package.json` (`cloudflare.bindings`) and the README.
5. Open a pull request explaining what changed and why.

## Rules
- Never store, log or send Bitly tokens anywhere except Bitly's API.
- Never commit real tokens or secrets.
- Keep it simple: no extra services or databases unless really needed.
- Keep the "Open source on GitHub" credit link.

## Security issues
Please don't open public issues for security problems. See [SECURITY.md](SECURITY.md).
