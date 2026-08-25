/* Live auction draft board — UI + interaction. Single operator types picks;
   the room watches. Everything persists to localStorage. */
(function () {
  const K = window.LEAGUE_DATA;
  const E = window.DraftEngine;
  const S = window.DraftStore;
  if (!K || !E || !S) return;

  S.init();
  const state = () => S.get();   // always read live state
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const $ = (id) => document.getElementById(id);
  const FALLBACK = 'https://a.espncdn.com/combiner/i?img=/i/headshots/nophoto.png&w=120&h=88';
  const COLORS = ['#1a7a55', '#b3312b', '#2b74c4', '#c9a227', '#7a52ba',
    '#159aae', '#d9702a', '#4f8c2a', '#a34070', '#5a6474'];

  $('season').textContent = state().season;

  /* ---------- searchable player universe ----------
     ESPN's full draftable list (js/players.js, ~1,000 incl. every K and D/ST)
     plus anyone on a keeper roster, so nothing is missing at the table. The
     keeper site's own pool is value-filtered and too thin for a live draft. */
  const uniq = new Map();
  const add = (p) => {
    const k = norm(p.name);
    if (k && !uniq.has(k)) uniq.set(k, p);
  };
  ((window.DRAFT_PLAYERS || {}).players || []).forEach((p) =>
    add({ name: p.name, pos: p.pos, nfl: p.nfl, img: p.img, aav: p.aav, rank: p.rank }));
  (K.teams || []).forEach((t) => t.players.forEach((p) =>
    add({ name: p.name, pos: p.pos, nfl: p.nfl, img: p.img, aav: p.market })));
  (K.pool || []).forEach((p) =>
    add({ name: p.name, pos: p.pos, nfl: p.nfl, img: p.img, aav: p.market }));
  const POOL = [...uniq.values()];
  // name -> ranked entry, so keepers (which come from the keeper site, with no
  // rank of their own) still slot by rank
  window.DRAFT_PLAYERS = window.DRAFT_PLAYERS || {};
  window.DRAFT_PLAYERS.byName = Object.fromEntries(
    ((window.DRAFT_PLAYERS.players) || []).map((p) => [norm(p.name), p]));

  const takenNames = () => new Set(state().teams.flatMap((t) =>
    t.players.map((p) => norm(p.name))));

  /* ---------- team select ---------- */
  const teamSel = $('f-team');
  teamSel.innerHTML = state().teams
    .map((t) => `<option value="${t.ti}">${esc(t.name)}</option>`).join('');

  /* ---------- typeahead ---------- */
  const inp = $('f-player'); const taList = $('ta-list');
  let taHits = [], taIdx = -1, picked = null;

  function closeTA() { taList.hidden = true; taList.innerHTML = ''; taHits = []; taIdx = -1; }
  function renderTA() {
    if (!taHits.length) return closeTA();
    taList.innerHTML = taHits.map((p, i) => `
      <div class="ta-item${i === taIdx ? ' on' : ''}" data-i="${i}">
        <span class="ta-name">${esc(p.name)}</span>
        <span class="ta-meta">${esc(p.pos || '')}${p.nfl ? ' · ' + esc(p.nfl) : ''}</span>
      </div>`).join('');
    taList.hidden = false;
  }
  inp.addEventListener('input', () => {
    picked = null;
    const q = norm(inp.value);
    if (!q) hideClock();          // cleared the name -> drop the takeover
    if (q.length < 2) return closeTA();
    const taken = takenNames();
    taHits = POOL
      .filter((p) => !taken.has(norm(p.name)) && norm(p.name).includes(q))
      // name-start matches first, then by ESPN value, so the guy actually being
      // bid on tops the list instead of a same-named practice-squad body
      .sort((a, b) => (norm(b.name).startsWith(q) - norm(a.name).startsWith(q))
        || ((b.aav || 0) - (a.aav || 0)))
      .slice(0, 8);
    taIdx = taHits.length ? 0 : -1;
    renderTA();
  });
  inp.addEventListener('keydown', (e) => {
    if (taList.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); taIdx = Math.min(taIdx + 1, taHits.length - 1); renderTA(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); taIdx = Math.max(taIdx - 1, 0); renderTA(); }
    else if (e.key === 'Enter' && taIdx >= 0) { e.preventDefault(); choose(taIdx); }
    else if (e.key === 'Escape') closeTA();
  });
  taList.addEventListener('click', (e) => {
    const it = e.target.closest('.ta-item');
    if (it) choose(+it.dataset.i);
  });
  function choose(i) {
    picked = taHits[i];
    inp.value = picked.name;
    closeTA();
    showClock(picked);
    $('f-cost').focus();
  }

  /* ---------- "on the clock" takeover while the room bids ---------- */
  function showClock(p) {
    $('clock-img').src = p.img || FALLBACK;
    $('clock-img').onerror = function () { this.onerror = null; this.src = FALLBACK; };
    $('clock-name').textContent = p.name;
    $('clock-meta').textContent = [p.pos, p.nfl].filter(Boolean).join(' · ') || ' ';
    clockPos = p.pos || null;
    $('clock').hidden = false;
    syncBid();          // paints the money rail too
  }
  function hideClock() { $('clock').hidden = true; }
  let clockPos = null;      // position of the player currently up
  function syncBid() {
    const v = parseInt($('f-cost').value, 10);
    const el = $('clock-bid');
    el.textContent = v >= 1 ? '$' + v : '—';
    el.classList.toggle('none', !(v >= 1));
    renderMoney(v, clockPos); // grey out who can't beat the bid; flag who needs him
  }
  $('f-cost').addEventListener('input', syncBid);

  /* every team's money, richest max-bid first — the question the room is
     actually asking while a player is up */
  /* Money only. Deliberately NO positional-need hints: the board must not
     tip the room off about who has to bid on what — that's each owner's
     business. Rules are enforced at entry instead (see canRoster). */
  function renderMoney(bid, pos) {
    const rows = state().teams
      .map((t) => ({ t, st: E.teamState(t) }))
      .sort((a, b) => b.st.maxBid - a.st.maxBid || b.st.remaining - a.st.remaining);
    $('clock-money-list').innerHTML = rows.map(({ t, st }) => {
      const full = st.open <= 0;
      // can't legally take this player: roster full, position maxed, or the
      // remaining spots are all spoken for by unfilled starters
      const blocked = !!pos && !full && !E.canRoster(t, pos).ok;
      const out = !full && bid >= 1 && st.maxBid <= bid;
      return `<div class="cm-row${out ? ' out' : ''}${full || blocked ? ' full' : ''}"
          style="--tc:${COLORS[t.ti % 10]}">
        <span class="cm-bar"></span>
        <span class="cm-team">${esc(t.name)}</span>
        <span class="cm-left">$${st.remaining}</span>
        <span class="cm-max">${full ? '<span class="cm-tag">full</span>'
          : blocked ? '<span class="cm-tag">n/a</span>' : '$' + st.maxBid}</span>
      </div>`;
    }).join('');
  }

  /* ---------- submit a pick ---------- */
  $('pick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const cost = parseInt($('f-cost').value, 10);
    const ti = +teamSel.value;
    let p = picked;
    if (!p) {   // allow free-typed names (rookies/DSTs not in ESPN data)
      const q = norm(inp.value);
      p = POOL.find((x) => norm(x.name) === q) ||
          (inp.value.trim() ? { name: inp.value.trim(), pos: '', nfl: null, img: null } : null);
    }
    if (!p || !(cost >= 1)) { inp.focus(); return; }

    const t = S.team(ti);
    const st = E.teamState(t);
    if (st.open <= 0) return flash(`${t.name} roster is full`);
    if (cost > st.maxBid) return flash(`Over max bid — ${t.name} can only bid $${st.maxBid}`);
    if (takenNames().has(norm(p.name))) return flash(`${p.name} is already rostered`);
    // league roster rules: position maximums + must finish a full starting lineup
    const legal = E.canRoster(t, p.pos);
    if (!legal.ok) return flash(`${t.name} ${legal.why}`);

    freshPick = p.name;
    const pick = S.addPick({ ti, name: p.name, pos: p.pos, nfl: p.nfl, img: p.img,
      cost, rank: p.rank != null ? p.rank : E.rankOf(p), aav: p.aav });
    setTimeout(() => { freshPick = null; }, 2600);
    hideClock();          // SOLD splash takes over from the clock
    horn();
    splash(t, pick);
    inp.value = ''; $('f-cost').value = ''; picked = null; closeTA();
    inp.focus();
  });

  function flash(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /* ---------- SOLD horn ----------
     Synthesized rather than a sound file so the board still works with no
     network at the venue. Two stacked fifths with a quick swell = stadium
     air-horn, short enough not to wear out over 150 picks. */
  let audioCtx = null;
  const soundOn = () => localStorage.getItem('sf-draft-mute') !== '1';
  function horn() {
    if (!soundOn()) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime;
      const master = audioCtx.createGain();
      master.connect(audioCtx.destination);
      master.gain.setValueAtTime(0.0001, t0);
      master.gain.exponentialRampToValueAtTime(0.32, t0 + 0.06);   // swell
      master.gain.setValueAtTime(0.32, t0 + 0.42);
      master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.72); // fall off
      [233.08, 349.23, 466.16].forEach((f, i) => {                 // Bb + F + Bb
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t0);
        g.gain.value = [0.5, 0.34, 0.2][i];
        o.connect(g); g.connect(master);
        o.start(t0); o.stop(t0 + 0.75);
      });
    } catch (e) { /* audio blocked — the board is still fully usable */ }
  }

  /* ---------- splash ---------- */
  let splashTimer;
  function splash(team, pick) {
    const box = $('splash');
    $('splash-img').src = pick.img || FALLBACK;
    $('splash-img').onerror = function () { this.onerror = null; this.src = FALLBACK; };
    $('splash-team').textContent = team.name;
    $('splash-name').textContent = pick.name;
    $('splash-meta').textContent = [pick.pos, pick.nfl].filter(Boolean).join(' · ');
    $('splash-cost').textContent = '$' + pick.cost;
    box.style.setProperty('--sc', COLORS[team.ti % 10]);
    box.hidden = false;
    box.classList.remove('go'); void box.offsetWidth; box.classList.add('go');
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => { box.hidden = true; }, 3200);
  }
  $('splash').addEventListener('click', () => { $('splash').hidden = true; });

  /* ---------- render ---------- */
  let freshPick = null;   // most recent pick, flashed in place for one render

  function slotRow(slot, p) {
    const bench = slot.id[0] === 'B' ? ' bench' : '';
    if (!p) return `<div class="slot empty${bench}"><span class="sl">${slot.label}</span>
      <span class="sp">—</span></div>`;
    const fresh = freshPick && p.name === freshPick ? ' fresh' : '';
    return `<div class="slot${bench}${p.keeper ? ' keeper' : ''}${fresh}">
      <span class="sl">${slot.label}</span>
      <span class="sp">${esc(p.name)}${p.keeper ? '<i class="kx">K</i>' : ''}</span>
      <span class="sc">$${p.cost}</span>
    </div>`;
  }

  function teamCard(t) {
    const st = E.teamState(t);
    const over = st.remaining < 0;                  // shouldn't happen; loudly flag if it does
    const low = !over && st.remaining <= 5;
    return `<section class="team${over ? ' over' : ''}" style="--tc:${COLORS[t.ti % 10]}">
      <header class="team-top">
        <h2>${esc(t.name)}${over ? ' <span class="warn">OVER BUDGET</span>' : ''}</h2>
        <div class="nums">
          <div class="num big${low || over ? ' low' : ''}"><b>$${st.remaining}</b><span>left</span></div>
          <div class="num max"><b>$${st.maxBid}</b><span>max bid</span></div>
          <div class="num minor"><b>${st.open}</b><span>spots</span></div>
          <div class="num minor"><b>$${st.avgPerOpen.toFixed(0)}</b><span>avg/spot</span></div>
        </div>
      </header>
      <div class="slots">
        ${E.SLOTS.map((s) => slotRow(s, st.slots[s.id])).join('')}
      </div>
    </section>`;
  }

  function render() {
    $('grid').innerHTML = state().teams.map(teamCard).join('');
    const picks = state().picks;
    const spent = picks.reduce((s, p) => s + p.cost, 0);
    const avg = picks.length ? (spent / picks.length).toFixed(1) : '0';
    $('draft-stats').innerHTML =
      `<b>${picks.length}</b> picks · <b>$${spent}</b> spent · avg <b>$${avg}</b>`;
    $('ticker').innerHTML = picks.slice(-14).reverse().map((p) => `
      <span class="tick" data-n="${p.n}" title="Click to remove (misentry)">
        <i style="background:${COLORS[p.ti % 10]}"></i>
        ${esc(p.name)} <b>$${p.cost}</b> <em>${esc(p.team)}</em></span>`).join('')
      || '<span class="tick muted">No picks yet — type a player, team, and price above.</span>';
    $('btn-undo').disabled = !S.canUndo();
  }
  S.onChange(render);

  $('ticker').addEventListener('click', (e) => {
    const t = e.target.closest('.tick');
    if (!t || !t.dataset.n) return;
    if (confirm('Remove this pick? (misentry)')) S.removePick(+t.dataset.n);
  });

  /* ---------- undo: the draft-night safety net ----------
     A mistyped price or wrong team is the likeliest mistake at speed, so undo
     is reachable three ways: the button, Ctrl/Cmd+Z anywhere, and clicking a
     pick in the crawl. Every path says out loud what it just reversed. */
  function doUndo() {
    const last = state().picks[state().picks.length - 1];
    if (!S.undo()) return flash('Nothing to undo');
    flash(last ? `Undid ${last.name} · $${last.cost}` : 'Undid last change');
  }
  $('btn-undo').addEventListener('click', doUndo);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      doUndo();
    }
  });

  /* ---------- keeper setup ---------- */
  const kModal = $('keeper-modal');
  function renderKeepers() {
    $('keeper-body').innerHTML = state().teams.map((t) => {
      const chosen = new Set(t.players.filter((p) => p.keeper).map((p) => p.name));
      const st = E.teamState(t);
      return `<div class="kteam" style="--tc:${COLORS[t.ti % 10]}">
        <div class="kteam-head">
          <b>${esc(t.name)}</b>
          <span>purse $${t.purse} · keepers $${st.spent} · left $${st.remaining}</span>
        </div>
        <div class="kchips">${t.keeperPool.map((p) => `
          <button type="button" class="kchip${chosen.has(p.name) ? ' on' : ''}"
            data-ti="${t.ti}" data-name="${esc(p.name)}">
            ${esc(p.name)} <i>$${p.cost}</i></button>`).join('')}</div>
      </div>`;
    }).join('');
  }
  $('btn-keepers').addEventListener('click', () => {
    // keepers are a pre-draft step; warn before touching them mid-auction
    if (state().picks.length &&
        !confirm(`${state().picks.length} picks are already in.\n\n` +
                 'Keepers are meant to be set before the draft. Drafted picks are ' +
                 'safe either way — open anyway?')) return;
    renderKeepers();
    kModal.hidden = false;
  });
  $('keeper-close').addEventListener('click', () => { kModal.hidden = true; });
  $('keeper-body').addEventListener('click', (e) => {
    const c = e.target.closest('.kchip');
    if (!c) return;
    const ti = +c.dataset.ti;
    const t = S.team(ti);
    const cur = new Set(t.players.filter((p) => p.keeper).map((p) => p.name));
    const name = c.dataset.name;
    cur.has(name) ? cur.delete(name) : cur.add(name);
    S.setKeepers(ti, [...cur]);
    renderKeepers();
  });

  /* ---------- menu ---------- */
  const mModal = $('menu-modal');
  $('btn-menu').addEventListener('click', () => { mModal.hidden = false; });
  $('menu-close').addEventListener('click', () => { mModal.hidden = true; });
  const dl = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  $('m-export').addEventListener('click', () =>
    dl(`sunday-funday-draft-${state().season}.json`, S.exportJSON(), 'application/json'));
  $('m-csv').addEventListener('click', () => {
    const rows = [['#', 'team', 'player', 'pos', 'nfl', 'cost']].concat(
      state().picks.map((p) => [p.n, p.team, p.name, p.pos, p.nfl || '', p.cost]));
    dl(`sunday-funday-picks-${state().season}.csv`,
      rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'),
      'text/csv');
  });
  const muteBtn = $('m-mute');
  const paintMute = () => {
    muteBtn.textContent = soundOn() ? 'Sound: on (SOLD horn)' : 'Sound: off';
  };
  muteBtn.addEventListener('click', () => {
    localStorage.setItem('sf-draft-mute', soundOn() ? '1' : '');
    paintMute();
    if (soundOn()) horn();          // preview it when switching back on
  });
  paintMute();

  $('m-reset').addEventListener('click', () => {
    if (confirm('Reset the entire draft? This clears all picks and keepers.')) {
      S.reset(); mModal.hidden = true;
    }
  });

  // keyboard: "/" jumps to the player field; Esc clears an aborted nomination
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== inp) { e.preventDefault(); inp.focus(); }
    if (e.key === 'Escape' && !$('clock').hidden) {
      hideClock();
      inp.value = ''; $('f-cost').value = ''; picked = null; closeTA();
      inp.focus();
    }
  });

  render();
  inp.focus();
})();
