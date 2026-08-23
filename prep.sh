#!/bin/bash
# Get the draft board ready for draft night — run this on Sept 5 or 6.
#
#   Values lock ... Wed Sept 2, noon CT
#   Keepers due ... Fri Sept 4, 7pm CT
#   DRAFT ......... Mon Sept 7 (Labor Day)
#
# Running it AFTER keepers are due means the board starts with final keeper
# values and final post-trade rosters. It also pulls a fresh player pool so
# late signings, rookies and depth-chart moves are all searchable.
set -e
cd "$(dirname "$0")"

echo "==> syncing keeper values + rosters from the keeper site"
if [ ! -f ../sunday-funday/js/data.js ]; then
  echo "!! can't find ../sunday-funday/js/data.js — is the keeper site checked out?" >&2
  exit 1
fi
cp ../sunday-funday/js/data.js js/keeperdata.js

echo "==> refreshing the draftable player pool from ESPN"
python3 build_players.py

echo "==> cache-busting the page"
STAMP=$(date +%Y%m%d%H%M)
sed -i '' -E "s/(css\/draft\.css|js\/[a-z]+\.js)\?v=[A-Za-z0-9]+/\1?v=$STAMP/g" index.html

echo "==> publishing"
git add -A
if git diff --cached --quiet; then
  echo "   nothing changed — already up to date"
else
  git commit -m "Draft prep: sync keepers + refresh player pool $(date +%Y-%m-%d)"
  git push
  echo "   pushed — live in a minute at https://mheinlen31.github.io/draft-board/"
fi

echo
echo "Ready. Open the board, hit Keepers, and tap what each team kept."
