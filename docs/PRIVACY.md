# Keeping a real house out of this repo

HouseOS comes from a dashboard that ran one real home. Before any of its code lands here:

1. Port with `tools/port.sh <server|client>/<file>.js`: it refuses files marked drop/pro/later in
   `docs/MODULES.md` and anything that fails the privacy scan.
2. Replace every house detail with a setting: IPs, device names, camera serials, plate numbers,
   family and pet names, network name, address, utility account, API keys.
3. Fresh history: this repo never imports the old repo's git history.
4. The pre-commit hook re-scans every commit (`git config core.hooksPath .githooks`).
5. Screenshots only from demo mode.
