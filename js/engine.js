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

  /* Fill starters first (most-constrained first so a TE doesn't eat FLEX while
     TE is open), then FLEX, then bench. Recomputed from scratch on every change
     so undo/edits can never leave a stale assignment. */
  function assignSlots(players) {
    const slots = {};
    SLOTS.forEach((s) => { slots[s.id] = null; });
    const left = players.slice();
    const put = (slotId, pred) => {
      if (slots[slotId]) return;
      const i = left.findIndex(pred);
      if (i >= 0) slots[slotId] = left.splice(i, 1)[0];
    };
    // dedicated starters
    put('QB', (p) => p.pos === 'QB');
    put('RB1', (p) => p.pos === 'RB');
    put('RB2', (p) => p.pos === 'RB');
    put('WR1', (p) => p.pos === 'WR');
    put('WR2', (p) => p.pos === 'WR');
    put('TE', (p) => p.pos === 'TE');
    put('K', (p) => p.pos === 'K');
    put('DEF', (p) => p.pos === 'D/ST');
    put('FLEX', (p) => ['RB', 'WR', 'TE'].includes(p.pos));
    // remainder to bench, in acquisition order
    ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].forEach((b) => {
      if (!slots[b] && left.length) slots[b] = left.shift();
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

  return { ROSTER_SIZE, SLOTS, assignSlots, teamState };
})();
