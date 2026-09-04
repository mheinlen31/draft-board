/* Live draft sync — mirrors the whole draft state to a Realtime DB room so any
   computer can run or watch the board. Reuses the pandy-open-2026 database
   (anonymous auth) that the keeper site's On the Block board already uses, in
   its own draft room.

   Design notes:
   - The state is written as ONE blob. The draft is a single operator entering
     picks in sequence, so per-field merging buys nothing and risks a torn
     roster; a whole-state write is atomic and trivially correct.
   - Every write carries a monotonic `rev` and the writing client's id. A
     client ignores its own echo, and ignores anything not newer than what it
     already has, so there is no feedback loop.
   - Firebase is an ENHANCEMENT, never a dependency. If it can't connect the
     board runs exactly as before off localStorage; the draft never stalls
     because the venue wifi is bad. */
window.DraftSync = (function () {
  const CONFIG = {
    apiKey: "AIzaSyBG2oR-YOOfi_IiHBErv-rKoqJ8zfhg3Xo",
    authDomain: "pandy-open-2026.firebaseapp.com",
    databaseURL: "https://pandy-open-2026-default-rtdb.firebaseio.com",
    projectId: "pandy-open-2026",
    appId: "1:658330035817:web:1ec09298fecf05222ee4f8",
  };
  const ROOM = "sunday-funday-draft-2026";
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
  let ready, mod, db, stateRef, online = false;

  function connect() {
    if (ready) return ready;
    ready = (async () => {
      const [{ initializeApp }, _db, _auth] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-database.js`),
        import(`${SDK}/firebase-auth.js`),
      ]);
      mod = _db;
      const app = initializeApp(CONFIG);
      try { await _auth.signInAnonymously(_auth.getAuth(app)); } catch (e) { /* open rules */ }
      db = mod.getDatabase(app);
      stateRef = mod.ref(db, `trips/${ROOM}/state`);
      online = true;
      return true;
    })();
    return ready;
  }

  return {
    /* cb(remoteState | null) on every remote change */
    subscribe(cb) {
      return connect().then(() => mod.onValue(stateRef, (s) => cb(s.val())));
    },
    publish(state) {
      if (!online) return Promise.resolve(false);
      return mod.set(stateRef, state).then(() => true).catch(() => false);
    },
    /* live connection indicator, independent of whether a write succeeded */
    onConnectionChange(cb) {
      return connect().then(() => {
        mod.onValue(mod.ref(db, ".info/connected"), (s) => cb(!!s.val()));
      });
    },
    isOnline() { return online; },
  };
})();
