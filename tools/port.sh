#!/bin/bash
# port.sh: bring one homedash module into CasaTorch - only if it passes the privacy scan.
#
#   tools/port.sh server/03-home-assistant.js      copy, then scan; refuses to keep it on a hit
#   tools/port.sh --force-copy server/x.js         copy anyway, to clean it up by hand (it is
#                                                  scanned again at commit, so nothing leaks)
#
# Source: ../homedash/dashboard/src (override with HOMEDASH_SRC). See docs/MODULES.md for
# what each file should become. The copy is a starting point: strip the dropped parts,
# turn house details into settings, then commit.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
src=${HOMEDASH_SRC:-$here/../homedash/dashboard/src}
force=0; [ "${1:-}" = --force-copy ] && { force=1; shift; }
rel=${1:?usage: tools/port.sh [--force-copy] server/NN-name.js}
action=$(awk -F'|' -v f="$(basename "$rel")" '$2 ~ " "f" " {gsub(/ /,"",$3); print $3}' "$here/docs/MODULES.md" | head -1)
case "$action" in
  drop) echo "$rel is marked 'drop' in docs/MODULES.md - not ported."; exit 1 ;;
  pro) echo "$rel is a Pro module - it belongs in the private casatorch-pro repo, not here."; exit 1 ;;
  later) echo "$rel is marked 'later' - not in v1."; exit 1 ;;
  "") echo "$rel is not in docs/MODULES.md - add it there first."; exit 1 ;;
esac
dest="$here/app/src/$rel"
[ -e "$dest" ] && { echo "$dest already exists - edit it there."; exit 1; }
cp "$src/$rel" "$dest"
echo "copied $rel ($action)"
if node "$here/tools/scrub-check.mjs" "$dest"; then
  echo "clean - review it, strip what docs/MODULES.md says, then commit."
elif [ $force = 1 ]; then
  echo "kept with the hits above - clean them before committing (the pre-commit hook will block it otherwise)."
else
  mv "$dest" "$dest.blocked"   # cannot delete in some setups; set aside instead
  echo "NOT kept: moved to ${dest#$here/}.blocked. Clean up a copy with --force-copy, or fix the source first."
  exit 1
fi
