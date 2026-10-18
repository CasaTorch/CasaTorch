# Contributing to CasaTorch

Thanks for helping. Bug reports, translations, docs fixes and code are all welcome. Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md). Security problems go to e-mail, not to an issue: see [SECURITY.md](SECURITY.md).

## Reporting a bug

Use the **Bug report** form under Issues. The most useful thing you can attach is a **support file**: in CasaTorch
open **Settings › Health › Get help › Make a support file**. Passwords, tokens, names, e-mail, IP and MAC addresses
are masked, and you see the whole file before you download or copy it. Read it once more before you post it -
issues are public.

## Working on the code

1. Run `git config core.hooksPath .githooks` once after cloning. The pre-commit hook runs
   `tools/scrub-check.mjs` and blocks commits that contain private IPs, MAC addresses, device
   serials, API keys or e-mail addresses.
2. Put your own names, plates, network names and address in `tools/private-terms.txt`
   (git-ignored) so the hook catches those too.
3. Use example values in code and docs: `192.168.1.10`, `example.com`, `Q2XX-XXXX-XXXX`.
4. `app/src/server/*.js` and `app/src/client/*.js` are joined in file-name order into `app/server.js` and
   `app/public/app.js` by `node build.mjs` (one scope per side: no duplicate top-level names). Run the demo with
   `cd app && npm ci && npm run demo`.
5. Before a pull request, run `cd app && npm test` (what CI runs; `npm run test:fast` skips the browser tests).
   The browser tests install Playwright once into your temp folder by themselves (or point `PLAYWRIGHT` at an
   installed copy); Chromium comes from `npx playwright install chromium`.
6. New integrations are one file in `app/src/server/` registered with `integration()` - see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). They must work (and stay quiet) when not configured
   (the tab shows "not set up", never an error).
7. Safety rule, no exceptions: nothing automatic and nothing the AI does may unlock doors, open garage doors or
   gates, or disarm alarms.
8. To work on the setup wizard without a real house: `node tools/mock-ha.mjs` is a pretend
   Home Assistant (token `test-token`), and `tools/test-setup-wizard.cjs` clicks through the whole
   wizard against it with Playwright.
9. By sending a pull request you agree your contribution may also be included in CasaTorch Pro
   (a short contributor license agreement will be added; until then, please say in your pull request that you agree).
