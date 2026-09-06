/* Draft grades — shown only once the last spot fills. Ranks the ten drafts
   on the lineup each team actually built (projected points of its best
   legal starting nine), the value it got at the auction and with its
   keepers (a dollar model built from projections over replacement, spread
   across the league's money), and its depth. Projections come from the
   War Room's blended, league-scoring pool, loaded on demand so nothing
   value-shaped is even fetched while the draft is running. */
window.DraftGrades = (function () {
  const E = window.DraftEngine;
  const NEED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, 'D/ST': 1 };
  const FLEX = ['RB', 'WR', 'TE'];
  // league-wide starter demand per position, FLEX shared by RB-heavy habit
  const DEMAND = { QB: 10, RB: 25, WR: 24, TE: 11, K: 10, 'D/ST': 10 };
  let pool = null, loading = null;

  function load() {
    if (window.GRADE_POOL) { index(); return Promise.resolve(true); }
    if (loading) return loading;
    loading = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'js/grades-data.js?t=' + Date.now();
      s.onload = () => { index(); res(!!pool); };
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return loading;
  }
  function index() {
    pool = {};
    ((window.GRADE_POOL || {}).players || []).forEach((p) => { pool[E.normName(p.name)] = p; });
  }
  const projOf = (p) => { const r = pool[E.normName(p.name)]; return r ? +r.proj || 0 : 0; };

  // best legal starting nine from a roster, greedy by projection
  function lineup(players) {
    const left = players.slice().sort((a, b) => projOf(b) - projOf(a));
    const starters = [];
    const take = (pos, n) => { for (let i = 0; i < n; i++) { const k = left.findIndex((p) => p.pos === pos); if (k >= 0) starters.push({ ...left.splice(k, 1)[0], slot: pos }); } };
    Object.keys(NEED).forEach((pos) => take(pos, NEED[pos]));
    const f = left.findIndex((p) => FLEX.includes(p.pos)); if (f >= 0) starters.push({ ...left.splice(f, 1)[0], slot: 'FLEX' });
    const bench = left.filter((p) => p.pos !== 'K' && p.pos !== 'D/ST');
    return { starters, total: starters.reduce((s, p) => s + projOf(p), 0),
             depth: bench.slice(0, 3).reduce((s, p) => s + projOf(p), 0) };
  }

  function grade(state) {
    const teams = state.teams || [];
    const rostered = teams.flatMap((t) => (t.players || []).map((p) => ({ ...p, team: t.name })));
    // replacement level per position = the last starter-caliber rostered player
    const repl = {};
    Object.keys(DEMAND).forEach((pos) => {
      const list = rostered.filter((p) => p.pos === pos).sort((a, b) => projOf(b) - projOf(a));
      const r = list[Math.min(list.length - 1, DEMAND[pos] - 1)];
      repl[pos] = r ? projOf(r) : 0;
    });
    // K and D/ST: this room has paid $1 for 85% of them in nine years, so their
    // point spreads buy nothing -- the best one is a $2 player, the rest $1.
    const FLAT = (p) => p.pos === 'K' || p.pos === 'D/ST';
    const flatTop = {};
    ['K', 'D/ST'].forEach((pos) => { const best = rostered.filter((p) => p.pos === pos).sort((a, b) => projOf(b) - projOf(a))[0]; if (best) flatTop[pos] = E.normName(best.name); });
    const vor = (p) => FLAT(p) ? 0 : Math.max(0, projOf(p) - (repl[p.pos] || 0));
    const sumVor = rostered.reduce((s, p) => s + vor(p), 0) || 1;
    const flatSpend = rostered.filter(FLAT).length + Object.keys(flatTop).length;   // their $1s and the two $2s
    const pot = teams.reduce((s, t) => s + (t.purse || 200), 0) - rostered.length - flatSpend;   // $1 floors off the top
    const value = (p) => FLAT(p) ? (flatTop[p.pos] === E.normName(p.name) ? 2 : 1) : Math.round(1 + pot * vor(p) / sumVor);

    const rows = teams.map((t) => {
      const lu = lineup(t.players || []);
      const picks = (t.players || []).filter((p) => !p.keeper).map((p) => ({ ...p, value: value(p), surplus: value(p) - (+p.cost || 0) }));
      const keeps = (t.players || []).filter((p) => p.keeper).map((p) => ({ ...p, value: value(p), surplus: value(p) - (+p.cost || 0) }));
      const st = E.teamState(t);
      const auction = picks.reduce((s, p) => s + p.surplus, 0);
      const keeper = keeps.reduce((s, p) => s + p.surplus, 0);
      const weakest = lu.starters.filter((p) => p.slot !== 'K' && p.slot !== 'D/ST')
        .map((p) => ({ p, over: projOf(p) - (repl[p.pos] || 0) })).sort((a, b) => a.over - b.over)[0];
      return { t, ti: t.ti, name: t.name, lineup: lu.total, depth: lu.depth, auction, keeper, total: auction + keeper,
        unspent: st.remaining, picks: picks.length,
        best: picks.slice().sort((a, b) => b.surplus - a.surplus)[0],
        reach: picks.slice().sort((a, b) => a.surplus - b.surplus)[0],
        mvp: lu.starters.slice().sort((a, b) => projOf(b) - projOf(a))[0],
        weak: weakest ? weakest.p : null };
    });
    const z = (key) => { const v = rows.map((r) => r[key]); const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return (r) => (r[key] - m) / sd; };
    const zl = z('lineup'), zt = z('total'), zd = z('depth');
    rows.forEach((r) => { r.score = 0.6 * zl(r) + 0.25 * zt(r) + 0.15 * zd(r) - (r.unspent > 3 ? 0.05 * Math.min(4, r.unspent / 5) : 0); });
    rows.sort((a, b) => b.score - a.score);
    const letter = (s) => s >= 1.0 ? 'A' : s >= 0.5 ? 'A−' : s >= 0.2 ? 'B+' : s >= -0.2 ? 'B' : s >= -0.5 ? 'B−' : s >= -1.0 ? 'C+' : 'C';
    rows.forEach((r, i) => { r.rank = i + 1; r.letter = letter(r.score); });
    return { rows, repl, generated: (window.GRADE_POOL || {}).generated };
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n < 0 ? '−$' : '+$') + Math.abs(Math.round(n));
  function render(box, state, colors) {
    return load().then((ok) => {
      if (!ok) { box.innerHTML = '<div class="finale-inner"><div class="finale-eyebrow">Sunday Funday</div><h2 class="finale-title">Draft Grades</h2><p class="gr-note">Grades data isn\'t published yet — it lands right after the draft.</p></div>'; return; }
      const g = grade(state);
      const wk = (pts) => (pts / 17).toFixed(1);
      box.innerHTML = `<div class="finale-inner grades-inner">
        <div class="finale-eyebrow">Sunday Funday · ${esc(state.season)} draft grades</div>
        <h2 class="finale-title">Draft Grades</h2>
        <p class="gr-note">Ranked on the lineup each team built (projected points of its best starting nine), the value it got at the auction and with its keepers, and its depth. Projections blended from ESPN, The Athletic and SB Nation in league scoring.</p>
        <div class="gr-list">${g.rows.map((r) => `
          <div class="gr" style="--tc:${colors[r.ti % 10]}">
            <div class="gr-rank">${r.rank}</div>
            <div class="gr-main">
              <div class="gr-name">${esc(r.name)}</div>
              <div class="gr-sub">${r.mvp ? `MVP ${esc(r.mvp.name)}` : ''}${r.weak ? ` · thinnest ${esc(r.weak.slot)}: ${esc(r.weak.name)}` : ''}${r.unspent > 0 ? ` · $${r.unspent} unspent` : ''}</div>
              <div class="gr-sub">${r.best ? `best buy ${esc(r.best.name)} $${r.best.cost} <i class="pos">(worth $${r.best.value})</i>` : ''}${r.reach && r.reach.surplus < 0 ? ` · reach ${esc(r.reach.name)} $${r.reach.cost} <i class="neg">(worth $${r.reach.value})</i>` : ''}</div>
            </div>
            <div class="gr-nums">
              <div class="gr-n"><b>${wk(r.lineup)}</b><span>proj / week</span></div>
              <div class="gr-n ${r.auction >= 0 ? 'pos' : 'neg'}"><b>${money(r.auction)}</b><span>auction value</span></div>
              <div class="gr-n ${r.keeper >= 0 ? 'pos' : 'neg'}"><b>${money(r.keeper)}</b><span>keeper value</span></div>
              <div class="gr-n"><b>${wk(r.depth)}</b><span>bench / week</span></div>
            </div>
            <div class="gr-grade">${r.letter}</div>
          </div>`).join('')}</div>
        <div class="finale-foot">tap anywhere to close · a model's opinion, not the standings</div>
      </div>`;
    });
  }
  return { load, grade, render };
})();
