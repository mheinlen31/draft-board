# Sunday Funday — Live Auction Draft Board

A big-screen board for draft night. One operator types each winning bid; the
room watches rosters, budgets, and max bids update instantly.

Separate from the keeper site (`~/sunday-funday`) — it only borrows a snapshot
of that data to seed rosters and prices.

## Running it

```bash
python3 -m http.server 4240 --directory ~/draft-board
```

Then open **http://localhost:4240** and put the browser fullscreen (⌘⌃F) on the TV.
Works fully offline once loaded — no wifi needed during the draft.

## Draft-night flow

1. **Before the draft:** click **Keepers**, tap each player a team is keeping.
   Their keeper price comes off that team's purse and fills a roster slot (gold).
2. **During:** type the player (typeahead), pick the team, type the price,
   hit **Sold** (or Enter). A full-screen splash announces the pick, then the
   board updates.
3. **Misentry:** click any pick in the bottom ticker to remove it, or hit
   **Undo** for the last action.
4. **After:** **⋯ → Export** saves the results as JSON or CSV.

### Shortcuts

| Key | Does |
|---|---|
| `/` | Jump to the player field |
| `Ctrl`/`⌘` + `Z` | Undo the last pick (works anywhere) |
| `Esc` | Cancel a nomination and clear the fields |

A short horn plays on each SOLD — toggle it from **⋯ → Sound**.

## What each team card shows

| Field | Meaning |
|---|---|
| **left** | Remaining auction dollars (turns red at ≤$5) |
| **max bid** | Most they can legally bid = remaining − $1 for every other open spot |
| **spots** | Open roster spots (15-man roster) |
| **avg/spot** | Remaining ÷ open spots — the "am I saving enough?" number |

Players auto-slot into QB / RB×2 / WR×2 / TE / FLEX / K / D-ST / 6 bench.

## Guardrails

- Blocks bids over a team's legal max bid
- Blocks drafting a player who's already rostered
- Blocks picks once a roster is full
- Everything saves to the browser automatically — a refresh or crash mid-draft
  loses nothing

## Data

`js/keeperdata.js` is a snapshot of the keeper site's `js/data.js` (rosters,
keeper prices, trade-adjusted purses, headshots, the free-agent pool). To
re-sync before the draft:

```bash
cp ~/sunday-funday/js/data.js ~/draft-board/js/keeperdata.js
```

Do this **after** the Sept 2 values lock so keeper prices are final.
