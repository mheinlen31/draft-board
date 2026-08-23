/* Draft state: teams + picks, persisted to localStorage so a browser crash or
   accidental refresh mid-draft loses nothing. Undo history for misentries. */
window.DraftStore = (function () {
  const KEY = 'sf-draft-2026';
  let state = null;
  const listeners = [];
  const undo = [];

  function seed() {
    const K = window.LEAGUE_DATA;
    const teams = (K.teams || []).map((t, ti) => ({
      ti, name: t.name, purse: t.purse || 200,
      // keepers = players the owner actually kept; seeded as roster+cost
      players: [],
      keeperPool: t.players.map((p) => ({
        name: p.name, pos: p.pos, nfl: p.nfl || null, img: p.img || null,
        cost: p.price, keeper: true, status: p.status,
      })),
    }));
    return { season: K.season || 2026, teams, picks: [], started: false };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { state = JSON.parse(raw); return; }
    } catch (e) { /* fall through to fresh */ }
    state = seed();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota */ }
    listeners.forEach((fn) => fn(state));
  }

  function snapshot() {
    undo.push(JSON.stringify({ teams: state.teams, picks: state.picks }));
    if (undo.length > 100) undo.shift();
  }

  return {
    init() { load(); return state; },
    get() { return state; },
    onChange(fn) { listeners.push(fn); },
    team(ti) { return state.teams.find((t) => t.ti === ti); },

    /* lock in which players each team actually kept (pre-draft step) */
    setKeepers(ti, names) {
      snapshot();
      const t = this.team(ti);
      t.players = t.keeperPool
        .filter((p) => names.includes(p.name))
        .map((p) => ({ ...p }));
      save();
    },
    startDraft() { snapshot(); state.started = true; save(); },

    addPick({ ti, name, pos, nfl, img, cost }) {
      snapshot();
      const t = this.team(ti);
      const pick = { name, pos, nfl: nfl || null, img: img || null,
        cost: +cost, keeper: false, n: state.picks.length + 1,
        ts: Date.now() };
      t.players.push(pick);
      state.picks.push({ ...pick, ti, team: t.name });
      save();
      return pick;
    },

    removePick(n) {
      snapshot();
      const p = state.picks.find((x) => x.n === n);
      if (!p) return;
      state.picks = state.picks.filter((x) => x.n !== n);
      const t = this.team(p.ti);
      const i = t.players.findIndex((x) => x.name === p.name && !x.keeper);
      if (i >= 0) t.players.splice(i, 1);
      save();
    },

    undo() {
      if (!undo.length) return false;
      const prev = JSON.parse(undo.pop());
      state.teams = prev.teams; state.picks = prev.picks;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      listeners.forEach((fn) => fn(state));
      return true;
    },
    canUndo() { return undo.length > 0; },

    reset() { state = seed(); undo.length = 0; save(); },
    exportJSON() { return JSON.stringify(state, null, 2); },
  };
})();
