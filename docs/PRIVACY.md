# Keeping a real house out of this repo

No real home's details belong in CasaTorch. Before any code lands here:

1. Run the privacy scan (`node tools/scrub-check.mjs <files>`); your own words go in the git-ignored
   `tools/private-terms.txt`.
2. Replace every house detail with a setting: IPs, device names, camera serials, plate numbers,
   family and pet names, network name, address, utility account, API keys.
3. Fresh history: this repo never imports another repo's git history.
4. The pre-commit hook re-scans every commit (`git config core.hooksPath .githooks`).
5. Screenshots only from demo mode.
