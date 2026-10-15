# Contributing to CasaTorch

1. Run `git config core.hooksPath .githooks` once after cloning. The pre-commit hook runs
   `tools/scrub-check.mjs` and blocks commits that contain private IPs, MAC addresses, device
   serials, API keys or e-mail addresses.
2. Put your own names, plates, network names and address in `tools/private-terms.txt`
   (git-ignored) so the hook catches those too.
3. Use example values in code and docs: `192.168.1.10`, `example.com`, `Q2XX-XXXX-XXXX`.
4. New integrations are one file in `app/src/server/` registered with `integration()` - see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). They must work (and stay quiet) when not configured
   (the tab shows "not set up", never an error).
5. By sending a pull request you agree your contribution may also be included in CasaTorch Pro
   (a short contributor license agreement will be added before the first release).
6. To work on the setup wizard without a real house: `node tools/mock-ha.mjs` is a pretend
   Home Assistant (token `test-token`), and `tools/test-setup-wizard.cjs` clicks through the whole
   wizard against it with Playwright.
