/* Draft state: teams + picks, persisted to localStorage so a browser crash or
   accidental refresh mid-draft loses nothing. Undo history for misentries. */
window.DraftStore = (function () {
  const KEY = 'sf-draft-2026';
  // identifies this browser tab so it can ignore the echo of its own writes
  const CLIENT = Math.random().toString(36).slice(2, 10);
  let state = null;
  const listeners = [];
  const syncers = [];
  const undo = [];

  function rankFor(name) {
    const key = String(name).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    const ref = (window.DRAFT_PLAYERS || {}).players || [];
    const hit = ref.find((x) => String(x.name).toLowerCase()
      .replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim() === key);
    return hit ? hit.rank : 9999;
  }

  /* Firebase drops empty arrays and objects entirely, and turns a
     non-contiguous array into an object keyed by index. So a state that has
     round-tripped through the network comes back subtly mis-shaped: a team
     that hasn't drafted anyone yet has NO `players` key at all, and the first
     pick for that team throws on undefined.push. Normalise every state that
     arrives from outside this tab before it is allowed near the UI. */
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      return Object.keys(v).sort((a, b) => a - b).map((k) => v[k]);
    }
    return [];
  }

  function normalize(st) {
    if (!st || typeof st !== 'object') return null;
    st.teams = asArray(st.teams);
    st.teams.forEach((t) => {
      t.players = asArray(t.players);
      t.keeperPool = asArray(t.keeperPool);
    });
    st.picks = asArray(st.picks);
    st.nomOrder = asArray(st.nomOrder);          // clockwise nomination order (team indices)
    st.nomOffset = +st.nomOffset || 0;           // manual skips/backs applied to the pointer
    return st;
  }

  function seed() {
    const K = window.LEAGUE_DATA;
    const teams = (K.teams || []).map((t, ti) => ({
      ti, name: t.name, purse: t.purse || 200,
      // keepers = players the owner actually kept; seeded as roster+cost
      players: [],
      keeperPool: t.players.map((p) => ({
        name: p.name, pos: p.pos, nfl: p.nfl || null, img: p.img || null,
        cost: p.price, keeper: true, status: p.status,
        rank: rankFor(p.name), aav: p.market || 0,
      })),
    }));
    // stamp the keeper data this seed was built from, so a state seeded
    // from older data can be told apart from a newer one
    return { season: K.season || 2026, teams, picks: [], started: false,
             nomOrder: [], nomOffset: 0, dataGen: K.generated || '' };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = normalize(JSON.parse(raw));
        const gen = ((window.LEAGUE_DATA || {}).generated) || '';
        // A prep.sh sync moves team names, purses and rosters. Any saved state
        // that predates the keeper data now loaded is obsolete -- keeping it
        // would show last week's league and, worse, republish it over everyone
        // else's fresh copy. Only discard when nothing has been drafted; once a
        // pick exists the saved state always wins.
        const obsolete = saved && !(saved.picks || []).length
          && (saved.dataGen || '') < gen;
        if (saved && !obsolete) { state = saved; return; }
      }
    } catch (e) { /* fall through to fresh */ }
    state = seed();
  }

  function save() {
    // rev is what lets other machines tell a newer draft from an older one
    state.rev = (state.rev || 0) + 1;
    state.by = CLIENT;
    write();
    syncers.forEach((fn) => fn(state));
  }

  /* Persist + repaint without touching rev — used when adopting a state that
     came FROM somewhere else, so we don't bounce it straight back out. */
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota */ }
    listeners.forEach((fn) => fn(state));
  }

  function snapshot() {
    undo.push(JSON.stringify({ teams: state.teams, picks: state.picks }));
    if (undo.length > 100) undo.shift();
  }

  /* Keep multiple tabs in step. Mirroring the board to a TV while also having
     it open on the operator's laptop is the likely setup — without this the two
     tabs hold separate in-memory state and the last one to write silently wipes
     the other's picks. */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try {
      state = JSON.parse(e.newValue);
      listeners.forEach(function (fn) { fn(state); });
    } catch (err) { /* ignore a malformed write */ }
    // no publish here: the tab that made the change has already sent it
  });

  return {
    init() { load(); return state; },
    get() { return state; },
    onChange(fn) { listeners.push(fn); },
    team(ti) { return state.teams.find((t) => t.ti === ti); },

    /* lock in which players each team actually kept (pre-draft step) */
    /* Replace only the KEEPER portion of a roster. Drafted picks are preserved —
       an accidental tap on a keeper chip mid-draft must never erase real picks
       (that used to silently desync the roster from the pick list). */
    setKeepers(ti, names) {
      snapshot();
      const t = this.team(ti);
      const drafted = t.players.filter((p) => !p.keeper);
      const keepers = t.keeperPool
        .filter((p) => names.includes(p.name))
        .map((p) => ({ ...p }));
      t.players = keepers.concat(drafted);
      save();
    },
    startDraft() { snapshot(); state.started = true; save(); },

    addPick({ ti, name, pos, nfl, img, cost, rank, aav }) {
      snapshot();
      const t = this.team(ti);
      const pick = { name, pos, nfl: nfl || null, img: img || null,
        cost: +cost, keeper: false, n: state.picks.length + 1,
        rank: rank == null ? 9999 : rank, aav: aav || 0,
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
      save();
      return true;
    },
    canUndo() { return undo.length > 0; },

    /* A reseed from newer keeper data must outrank the room's copy or the
       revision guard on publish will (rightly) refuse it. */
    bumpRevPast(n) { state.rev = Math.max(state.rev || 0, (+n || 0) + 1); state.by = CLIENT; write(); },

    /* Nomination order: set once the room sits down (clockwise from whoever
       goes first). Who's up is derived from the pick count, so undo walks it
       back on its own; a skip or a back is a manual offset. */
    setOrder(order) { state.nomOrder = (order || []).slice(); state.nomOffset = 0; save(); },
    bumpNom(delta) { state.nomOffset = (state.nomOffset || 0) + delta; save(); },
    nominatorTi() {
      const o = state.nomOrder || [];
      if (!o.length) return null;
      const n = o.length, i = (((state.picks.length + (state.nomOffset || 0)) % n) + n) % n;
      return o[i];
    },

    reset() { state = seed(); undo.length = 0; save(); },

    /* --- live sync plumbing --- */
    clientId() { return CLIENT; },
    normalize(st) { return normalize(st); },
    onPublish(fn) { syncers.push(fn); },
    /* Take a state that arrived from another machine. Newer-wins: a stale or
       self-authored snapshot is ignored by the caller before it gets here. */
    adopt(remote) {
      state = normalize(remote);
      undo.length = 0;   // the undo stack belonged to the old timeline
      write();
    },
    exportJSON() { return JSON.stringify(state, null, 2); },
  };
})();
