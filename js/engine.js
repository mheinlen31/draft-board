/* Sunday Funday — LIVE AUCTION DRAFT BOARD: engine
   Roster slotting + budget math per Manifesto v5.1.
     roster: QB1, RB2, WR2, TE1, FLEX(RB/WR/TE)1, K1, DEF1, Bench6 = 15
     each team: purse (from the keeper site, trade-adjusted); keepers pre-loaded
     max bid = remaining - $1 * (open spots - 1)   [must leave $1 for each other spot]
*/
window.DraftEngine = (function () {
  const ROSTER_SIZE = 15;
  const SLOTS = [
    { id: 'QB', label: 'QB', takes: ['QB'] },
    { id: 'RB1', label: 'RB', takes: ['RB'] },
    { id: 'RB2', label: 'RB', takes: ['RB'] },
    { id: 'WR1', label: 'WR', takes: ['WR'] },
    { id: 'WR2', label: 'WR', takes: ['WR'] },
    { id: 'TE', label: 'TE', takes: ['TE'] },
    { id: 'FLEX', label: 'FLEX', takes: ['RB', 'WR', 'TE'] },
    { id: 'K', label: 'K', takes: ['K'] },
    { id: 'DEF', label: 'D/ST', takes: ['D/ST'] },
    { id: 'B1', label: 'BE', takes: null }, { id: 'B2', label: 'BE', takes: null },
    { id: 'B3', label: 'BE', takes: null }, { id: 'B4', label: 'BE', takes: null },
    { id: 'B5', label: 'BE', takes: null }, { id: 'B6', label: 'BE', takes: null },
  ];

  /* Rank-aware slotting, recomputed from scratch on every roster change so the
     board always reflects the CURRENT best lineup (never acquisition order):

       - Each positional slot goes to that position's best available player, so
         a newly drafted stud takes RB1 and bumps the incumbent to RB2.
       - FLEX then takes the best remaining RB/WR/TE overall — so a strong WR3
         beats a weak RB3 for the spot, and a later, better pick takes it over.
       - Whatever's left falls to the bench, best players first.

     Lower `rank` = better (ESPN PPR overall rank); AAV breaks ties, then a
     stable name sort so the display never jitters between equal players. */
  const FLEX_POS = ['RB', 'WR', 'TE'];

  function betterFirst(a, b) {
    return (rankOf(a) - rankOf(b)) || ((b.aav || 0) - (a.aav || 0))
      || String(a.name).localeCompare(String(b.name));
  }
  function rankOf(p) {
    if (p.rank != null) return p.rank;
    const ref = (window.DRAFT_PLAYERS || {}).byName;
    const hit = ref && ref[normName(p.name)];
    return hit ? hit.rank : 9999;
  }
  function normName(s) {
    return String(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function assignSlots(players) {
    const slots = {};
    SLOTS.forEach((s) => { slots[s.id] = null; });
    // work on a rank-sorted copy: best players get first claim on every slot
    const left = players.slice().sort(betterFirst);
    const take = (slotId, ok) => {
      const i = left.findIndex(ok);
      if (i >= 0) slots[slotId] = left.splice(i, 1)[0];
    };
    const isPos = (pos) => (p) => p.pos === pos;

    // dedicated starters, each taking the best available at that position
    take('QB', isPos('QB'));
    take('RB1', isPos('RB'));
    take('RB2', isPos('RB'));
    take('WR1', isPos('WR'));
    take('WR2', isPos('WR'));
    take('TE', isPos('TE'));
    take('K', isPos('K'));
    take('DEF', isPos('D/ST'));
    // FLEX: best remaining RB/WR/TE regardless of position
    take('FLEX', (p) => FLEX_POS.includes(p.pos));
    // bench, best first
    ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].forEach((b) => {
      if (left.length) slots[b] = left.shift();
    });
    return { slots, overflow: left };   // overflow = beyond 15 (shouldn't happen)
  }

  function teamState(team) {
    const players = team.players || [];
    const spent = players.reduce((s, p) => s + (+p.cost || 0), 0);
    const remaining = (team.purse || 0) - spent;
    const filled = players.length;
    const open = Math.max(0, ROSTER_SIZE - filled);
    // must reserve $1 for every OTHER open spot
    const maxBid = open > 0 ? Math.max(0, remaining - (open - 1)) : 0;
    const drafted = players.filter((p) => !p.keeper);
    const draftSpend = drafted.reduce((s, p) => s + (+p.cost || 0), 0);
    return {
      spent, remaining, filled, open, maxBid,
      avgPerPick: drafted.length ? draftSpend / drafted.length : 0,
      avgPerOpen: open > 0 ? remaining / open : 0,
      ...assignSlots(players),
    };
  }

  return { ROSTER_SIZE, SLOTS, assignSlots, teamState, rankOf, normName, betterFirst };
})();
