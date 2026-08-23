#!/usr/bin/env python3
"""Build js/players.js — the draft board's searchable player universe.

The keeper site's pool is deliberately filtered to players with real auction
value; a draft needs EVERYONE draftable (including $1 kickers and all 32
D/STs), so this pulls ESPN's full draftable list instead.

Run:  python3 build_players.py
"""
import json
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEASON = 2026
URL = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/"
       f"{SEASON}/segments/0/leaguedefaults/3?view=kona_player_info")
FILTER = {"players": {"limit": 2000, "sortDraftRanks": {
    "sortPriority": 100, "sortAsc": True, "value": "STANDARD"}}}
POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST"}
PRO_TEAM = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
    15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
    22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
    29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}
NFL_ABBR = {
    "cardinals": "ari", "falcons": "atl", "ravens": "bal", "bills": "buf",
    "panthers": "car", "bears": "chi", "bengals": "cin", "browns": "cle",
    "cowboys": "dal", "broncos": "den", "lions": "det", "packers": "gb",
    "texans": "hou", "colts": "ind", "jaguars": "jax", "chiefs": "kc",
    "raiders": "lv", "chargers": "lac", "rams": "lar", "dolphins": "mia",
    "vikings": "min", "patriots": "ne", "saints": "no", "giants": "nyg",
    "jets": "nyj", "eagles": "phi", "steelers": "pit", "49ers": "sf",
    "seahawks": "sea", "buccaneers": "tb", "titans": "ten", "commanders": "wsh",
}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z ]", "", s.lower().replace(".", " ").replace("'", ""))
    return " ".join(p for p in s.split() if p not in SUFFIXES)


def img(name, pos, pid):
    if pos == "D/ST":
        ab = NFL_ABBR.get(norm(name))
        return f"https://a.espncdn.com/i/teamlogos/nfl/500/{ab}.png" if ab else None
    return f"https://a.espncdn.com/i/headshots/nfl/players/full/{pid}.png" if pid else None


def main():
    req = urllib.request.Request(URL, headers={
        "X-Fantasy-Filter": json.dumps(FILTER), "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.load(r)

    seen, out = set(), []
    for entry in data.get("players", []):
        p = entry.get("player") or {}
        pos = POS.get(p.get("defaultPositionId"))
        if not pos:
            continue
        name = (p.get("fullName") or "").replace(" D/ST", "").strip()
        if not name or norm(name) in seen:
            continue
        seen.add(norm(name))
        aav = (p.get("ownership") or {}).get("auctionValueAverage") or 0
        out.append({
            "name": name, "pos": pos,
            "nfl": PRO_TEAM.get(p.get("proTeamId")) if pos != "D/ST" else None,
            "img": img(name, pos, p.get("id")),
            "aav": round(aav, 1),          # ESPN avg auction value, for reference
        })

    # most valuable first so typeahead surfaces the guys actually being bid on
    out.sort(key=lambda x: (-x["aav"], x["name"]))
    payload = {"season": SEASON,
               "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "players": out}
    (ROOT / "js" / "players.js").write_text(
        "window.DRAFT_PLAYERS = " + json.dumps(payload) + ";\n")

    from collections import Counter
    print(f"wrote {len(out)} players:", dict(Counter(p["pos"] for p in out)))


if __name__ == "__main__":
    main()
