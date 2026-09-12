// script.js — Chain Reaction client (Firebase Realtime Database version, no server needed)

// ============================================================
// STEP 1 OF SETUP: paste your Firebase config here.
// Get this from: Firebase Console -> Project settings -> General -> Your apps -> Web app
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA3zcf75nnJrD2O2dvUFaI0LjhAjRArrCE",
  authDomain: "chainreaction-c3f08.firebaseapp.com",
  databaseURL: "https://chainreaction-c3f08-default-rtdb.firebaseio.com",
  projectId: "chainreaction-c3f08",
  storageBucket: "chainreaction-c3f08.firebasestorage.app",
  messagingSenderId: "418727144824",
  appId: "1:418727144824:web:3b9be9ef3d8206ada86c8d"
};

(function () {

  // ---------- constants ----------
  const ROWS = 9, COLS = 6;
  const COLORS = [
    { name: 'Cyan',    hex: '#4cc9f0', dark: '#0f4e63' },
    { name: 'Magenta', hex: '#f72585', dark: '#6b0f39' },
    { name: 'Amber',   hex: '#ffb703', dark: '#6b4a03' },
    { name: 'Lime',    hex: '#8ae65c', dark: '#33591f' },
    { name: 'Violet',  hex: '#b388ff', dark: '#3c2266' },
    { name: 'Coral',   hex: '#ff6b6b', dark: '#661f1f' },
  ];

  // ---------- firebase init ----------
  let db = null;
  let firebaseReady = false;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    firebaseReady = true;
  } catch (e) {
    console.error('Firebase init failed:', e);
  }

  // ---------- persistent identity ----------
  function makeId() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (e) { /* fall through */ }
    }
    return 'p-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  let myId = localStorage.getItem('cr_playerId');
  if (!myId) { myId = makeId(); localStorage.setItem('cr_playerId', myId); }

  // ---------- state ----------
  let room = null;
  let roomCode = null;
  let roomListenerRef = null;
  let animating = false;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  const cellCapacity = (r, c) => {
    let n = 0;
    if (r > 0) n++; if (r < ROWS - 1) n++; if (c > 0) n++; if (c < COLS - 1) n++;
    return n;
  };
  const neighbors = (r, c) => {
    const out = [];
    if (r > 0) out.push([r - 1, c]);
    if (r < ROWS - 1) out.push([r + 1, c]);
    if (c > 0) out.push([r, c - 1]);
    if (c < COLS - 1) out.push([r, c + 1]);
    return out;
  };
  const deepCloneBoard = (b) => b.map((row) => row.map((cell) => ({ ...cell })));
  const emptyBoard = () => {
    const b = [];
    for (let r = 0; r < ROWS; r++) { const row = []; for (let c = 0; c < COLS; c++) row.push({ count: 0, owner: null }); b.push(row); }
    return b;
  };
  const genCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };

  function roomRef(code) { return db.ref('rooms/' + code); }
  function turnOrder(r) { return r.turnOrder || []; }
  function playerList(r) { return turnOrder(r).map((id) => ({ id, ...(r.players ? r.players[id] : {}) })); }
  function currentPlayer() {
    if (!room) return null;
    const id = turnOrder(room)[room.currentPlayerIndex];
    return id ? { id, ...room.players[id] } : null;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  function setConnStatus(kind, text) {
    const el = $('connStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'conn-status ' + kind;
  }

  if (!firebaseReady) {
    setConnStatus('bad', 'Firebase is not configured yet — see script.js');
  } else {
    db.ref('.info/connected').on('value', (snap) => {
      setConnStatus(snap.val() === true ? 'ok' : 'bad', snap.val() === true ? 'Connected' : 'Reconnecting…');
    });
  }

  // ---------- screens ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }
  function setError(msg) { const el = $('homeError'); if (el) el.textContent = msg || ''; }

  // ---------- subscribing to a room ----------
  function subscribeRoom(code) {
    unsubscribeRoom();
    roomCode = code;
    localStorage.setItem('cr_room', code);
    roomListenerRef = roomRef(code);
    roomListenerRef.on('value', (snap) => {
      const val = snap.val();
      if (!val) {
        // room was deleted (e.g. everyone left)
        room = null;
        localStorage.removeItem('cr_room');
        showToast('That room no longer exists.');
        showScreen('screen-home');
        return;
      }
      room = val;
      if (!room.players || !room.players[myId]) {
        // we're not (or no longer) a member of this room
        return;
      }
      routeToCurrentScreen();
    });

    // presence: mark myself offline automatically if my connection drops
    const connRef = db.ref('.info/connected');
    connRef.on('value', (snap) => {
      if (snap.val() === true) {
        const meRef = roomRef(code).child('players').child(myId).child('connected');
        meRef.onDisconnect().set(false);
        meRef.set(true);
      }
    });
  }
  function unsubscribeRoom() {
    if (roomListenerRef) { roomListenerRef.off(); roomListenerRef = null; }
  }

  function routeToCurrentScreen() {
    if (!room) return;
    if (room.winnerId) {
      renderGameIfBuilt();
      showGameOver();
    } else if (room.started) {
      showScreen('screen-game');
      buildBoardDomIfNeeded();
      renderGame();
    } else {
      showScreen('screen-lobby');
      renderLobby();
    }
  }

  // ---------- home screen ----------
  $('btnCreate').addEventListener('click', async () => {
    if (!firebaseReady) { showToast('Firebase is not configured yet — see script.js'); return; }
    const name = $('nameInput').value.trim();
    if (!name) { setError('Enter your name first.'); return; }
    setError('');
    localStorage.setItem('cr_name', name);
    $('btnCreate').disabled = true;
    try {
      let code, exists = true;
      for (let i = 0; i < 5 && exists; i++) {
        code = genCode();
        const snap = await roomRef(code).once('value');
        exists = snap.exists();
      }
      const initial = {
        code, hostId: myId, started: false, winnerId: null,
        turnOrder: [myId],
        players: { [myId]: { name, colorIdx: 0, alive: true, movesMade: 0, connected: true } },
        board: null, currentPlayerIndex: 0, firstRoundDone: false, rows: ROWS, cols: COLS,
      };
      await roomRef(code).set(initial);
      subscribeRoom(code);
    } catch (e) {
      console.error(e);
      showToast('Could not create a room. Check your Firebase setup / internet connection.');
    } finally {
      $('btnCreate').disabled = false;
    }
  });

  $('btnJoin').addEventListener('click', async () => {
    if (!firebaseReady) { showToast('Firebase is not configured yet — see script.js'); return; }
    const name = $('nameInput').value.trim();
    const code = $('codeInput').value.trim().toUpperCase();
    if (!name) { setError('Enter your name first.'); return; }
    if (code.length !== 4) { setError('Room codes are 4 letters.'); return; }
    setError('');
    localStorage.setItem('cr_name', name);
    $('btnJoin').disabled = true;
    let abortReason = null;
    try {
      const result = await roomRef(code).transaction((r) => {
        if (r === null) { abortReason = 'NOT_FOUND'; return; }
        if (r.players && r.players[myId]) return r; // already a member — treat as rejoin
        if (r.started) { abortReason = 'STARTED'; return; }
        const count = (r.turnOrder || []).length;
        if (count >= 6) { abortReason = 'FULL'; return; }
        const usedColors = new Set(Object.values(r.players || {}).map((p) => p.colorIdx));
        let colorIdx = 0; while (usedColors.has(colorIdx) && colorIdx < 5) colorIdx++;
        r.players = r.players || {};
        r.players[myId] = { name, colorIdx, alive: true, movesMade: 0, connected: true };
        r.turnOrder = r.turnOrder || [];
        r.turnOrder.push(myId);
        return r;
      });
      if (!result.committed) {
        if (abortReason === 'NOT_FOUND') setError('No room found with that code.');
        else if (abortReason === 'STARTED') setError('That game has already started.');
        else if (abortReason === 'FULL') setError('That room is full (6 players max).');
        else setError('Could not join that room.');
        return;
      }
      subscribeRoom(code);
    } catch (e) {
      console.error(e);
      showToast('Could not join. Check your Firebase setup / internet connection.');
    } finally {
      $('btnJoin').disabled = false;
    }
  });

  $('codeInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  const savedName = localStorage.getItem('cr_name');
  if (savedName) $('nameInput').value = savedName;

  // ---------- lobby ----------
  function renderLobby() {
    if (!room) return;
    $('lobbyCode').textContent = room.code;
    $('gameCode').textContent = room.code;

    const list = $('lobbyPlayers');
    list.innerHTML = '';
    playerList(room).forEach((p) => {
      const col = COLORS[p.colorIdx || 0];
      const div = document.createElement('div');
      div.className = 'player-chip' + (p.connected === false ? ' offline' : '');
      div.innerHTML = `<span class="dot" style="background:${col.hex}; color:${col.hex};"></span>
        <span class="name">${escapeHtml(p.name || 'Player')}</span>
        ${p.id === myId ? '<span class="tagme">(you)</span>' : ''}
        ${p.id === room.hostId ? '<span class="host-badge">HOST</span>' : (p.connected === false ? '<span class="offline-badge">offline</span>' : '')}`;
      list.appendChild(div);
    });

    const isHost = room.hostId === myId;
    $('lobbyHostControls').classList.toggle('hidden', !isHost);
    $('lobbyWaitNote').classList.toggle('hidden', isHost);
    $('btnStart').disabled = turnOrder(room).length < 2;
  }

  $('btnStart').addEventListener('click', async () => {
    if (!room || room.hostId !== myId || turnOrder(room).length < 2) return;
    $('btnStart').disabled = true;
    try {
      await roomRef(roomCode).transaction((r) => {
        if (!r) return;
        if (r.hostId !== myId || r.started) return r;
        if ((r.turnOrder || []).length < 2) return r;
        r.board = emptyBoard();
        r.started = true;
        r.winnerId = null;
        r.currentPlayerIndex = 0;
        r.firstRoundDone = false;
        Object.keys(r.players).forEach((id) => { r.players[id].alive = true; r.players[id].movesMade = 0; });
        return r;
      });
    } catch (e) {
      console.error(e);
      showToast('Could not start the game — try again.');
      $('btnStart').disabled = false;
    }
  });

  $('btnLeaveLobby').addEventListener('click', leaveToHome);
  $('btnLeaveGame').addEventListener('click', leaveToHome);
  $('btnBackHome').addEventListener('click', leaveToHome);

  async function leaveToHome() {
    if (roomCode) {
      try {
        await roomRef(roomCode).transaction((r) => {
          if (!r) return;
          if (r.players) delete r.players[myId];
          r.turnOrder = (r.turnOrder || []).filter((id) => id !== myId);
          if (r.turnOrder.length === 0) return null; // deletes the room
          if (r.hostId === myId) r.hostId = r.turnOrder[0];
          if (r.currentPlayerIndex >= r.turnOrder.length) r.currentPlayerIndex = 0;
          return r;
        });
      } catch (e) { console.error(e); }
    }
    unsubscribeRoom();
    localStorage.removeItem('cr_room');
    room = null; roomCode = null; boardBuilt = false;
    $('codeInput').value = ''; setError('');
    showScreen('screen-home');
  }

  $('copyCode').addEventListener('click', () => {
    if (!room) return;
    const code = room.code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(() => fallbackCopy(code));
    } else {
      fallbackCopy(code);
    }
    const el = $('copyCode');
    const old = el.textContent;
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = old; }, 1200);
  });
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  // ---------- game screen ----------
  let boardBuilt = false;
  function buildBoardDomIfNeeded() {
    if (boardBuilt) return;
    const boardEl = $('board');
    boardEl.style.setProperty('--rows', ROWS);
    boardEl.style.setProperty('--cols', COLS);
    boardEl.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r; cell.dataset.c = c;
        cell.addEventListener('click', onCellClick);
        boardEl.appendChild(cell);
      }
    }
    boardBuilt = true;
  }
  function renderGameIfBuilt() {
    if (room && room.started) { buildBoardDomIfNeeded(); renderGame(); }
  }

  function renderGame() {
    if (!room || !room.board) return;
    $('gameCode').textContent = room.code;

    const cp = currentPlayer();
    const banner = $('turnBanner');
    const isMine = cp && cp.id === myId && !room.winnerId;
    banner.classList.toggle('mine', isMine);
    banner.style.color = cp ? COLORS[cp.colorIdx].hex : '';
    banner.textContent = room.winnerId ? 'Game over' : (isMine ? 'Your turn — pick a cell' : `${cp ? cp.name : '...'}'s turn`);

    const strip = $('playersStrip');
    strip.innerHTML = '';
    playerList(room).forEach((p, idx) => {
      const col = COLORS[p.colorIdx || 0];
      const chip = document.createElement('div');
      chip.className = 'pchip'
        + (idx === room.currentPlayerIndex && !room.winnerId ? ' active-turn' : '')
        + (!p.alive ? ' eliminated' : '')
        + (p.connected === false ? ' offline' : '');
      chip.style.color = idx === room.currentPlayerIndex ? col.hex : '';
      chip.innerHTML = `<span class="dot" style="background:${col.hex}; color:${col.hex};"></span>${escapeHtml(p.name || 'Player')}${p.id === myId ? ' (you)' : ''}`;
      strip.appendChild(chip);
    });

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) renderCell(r, c, room.board[r][c]);
    }
  }

  function renderCell(r, c, cellData) {
    const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (!el || !cellData) return;
    const cap = cellCapacity(r, c);
    const cp = currentPlayer();
    const clickable = room.started && !room.winnerId && cp && cp.id === myId &&
      (cellData.owner === null || cellData.owner === myId) && !animating;
    el.classList.toggle('clickable', !!clickable);

    const isDanger = cellData.count === cap - 1 && cellData.owner !== null;
    el.classList.toggle('danger', isDanger);
    if (cellData.owner !== null && room.players[cellData.owner]) {
      const col = COLORS[room.players[cellData.owner].colorIdx || 0];
      el.style.setProperty('--cell-glow', col.hex + '99');
    }

    el.innerHTML = '';
    if (cellData.count <= 0) return;
    const ownerData = room.players[cellData.owner];
    const col = ownerData ? COLORS[ownerData.colorIdx || 0] : COLORS[0];
    const positions = cellData.count === 1 ? ['o1'] : cellData.count === 2 ? ['o2a', 'o2b'] : ['o3a', 'o3b', 'o3c'];
    positions.forEach((posClass) => {
      const orb = document.createElement('div');
      orb.className = 'orb ' + posClass;
      orb.style.setProperty('--oc', col.hex);
      orb.style.setProperty('--oc-d', col.dark);
      el.appendChild(orb);
    });
  }

  function burstAt(r, c, hex) {
    const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (!el) return;
    const ring = document.createElement('div');
    ring.className = 'burst-ring';
    ring.style.setProperty('--bc', hex);
    el.appendChild(ring);
    setTimeout(() => ring.remove(), 520);
  }

  // ---------- move handling ----------
  async function onCellClick(e) {
    if (animating || !room || !room.started || room.winnerId) return;
    const r = parseInt(e.currentTarget.dataset.r, 10);
    const c = parseInt(e.currentTarget.dataset.c, 10);
    const cp = currentPlayer();
    if (!cp || cp.id !== myId) return;
    const cellData = room.board[r][c];
    if (!(cellData.owner === null || cellData.owner === myId)) return;

    animating = true;

    // local optimistic animation for instant feedback
    let board = deepCloneBoard(room.board);
    board[r][c].count++;
    board[r][c].owner = myId;
    renderCell(r, c, board[r][c]);

    let queue = [{ r, c }];
    let safety = 0;
    while (queue.length && safety < 400) {
      safety++;
      const seen = new Set();
      const toExplode = [];
      queue.forEach((cell) => {
        const key = cell.r + '-' + cell.c;
        if (seen.has(key)) return; seen.add(key);
        if (board[cell.r][cell.c].count >= cellCapacity(cell.r, cell.c)) toExplode.push(cell);
      });
      if (toExplode.length === 0) break;

      const myCol = COLORS[cp.colorIdx];
      toExplode.forEach((cell) => burstAt(cell.r, cell.c, myCol.hex));

      const nextSeen = new Set();
      const nextQueue = [];
      toExplode.forEach((cell) => {
        const cap = cellCapacity(cell.r, cell.c);
        board[cell.r][cell.c].count -= cap;
        if (board[cell.r][cell.c].count <= 0) { board[cell.r][cell.c].count = 0; board[cell.r][cell.c].owner = null; }
        neighbors(cell.r, cell.c).forEach(([nr, nc]) => {
          board[nr][nc].count++;
          board[nr][nc].owner = myId;
          const key = nr + '-' + nc;
          if (!nextSeen.has(key)) { nextSeen.add(key); nextQueue.push({ r: nr, c: nc }); }
        });
      });

      toExplode.forEach((cell) => renderCell(cell.r, cell.c, board[cell.r][cell.c]));
      nextQueue.forEach((cell) => renderCell(cell.r, cell.c, board[cell.r][cell.c]));
      await sleep(230);
      queue = nextQueue;
    }

    // authoritative recomputation happens inside a Firebase transaction,
    // so simultaneous/late submissions from a stale client are safely rejected.
    try {
      await roomRef(roomCode).transaction((room2) => {
        if (!room2 || !room2.started || room2.winnerId) return;
        const order = room2.turnOrder || [];
        const cpId = order[room2.currentPlayerIndex];
        if (cpId !== myId) return; // not my turn (stale) -- abort, listener will resync
        const cd = room2.board[r][c];
        if (!(cd.owner === null || cd.owner === myId)) return;

        let b = room2.board;
        b[r][c].count++;
        b[r][c].owner = myId;

        let q = [{ r, c }];
        let s2 = 0;
        while (q.length && s2 < 400) {
          s2++;
          const seen2 = new Set();
          const explode = [];
          q.forEach((cell) => {
            const key = cell.r + '-' + cell.c;
            if (seen2.has(key)) return; seen2.add(key);
            if (b[cell.r][cell.c].count >= cellCapacity(cell.r, cell.c)) explode.push(cell);
          });
          if (explode.length === 0) break;
          const nextSeen2 = new Set();
          const nq = [];
          explode.forEach((cell) => {
            const cap = cellCapacity(cell.r, cell.c);
            b[cell.r][cell.c].count -= cap;
            if (b[cell.r][cell.c].count <= 0) { b[cell.r][cell.c].count = 0; b[cell.r][cell.c].owner = null; }
            neighbors(cell.r, cell.c).forEach(([nr, nc]) => {
              b[nr][nc].count++;
              b[nr][nc].owner = myId;
              const key = nr + '-' + nc;
              if (!nextSeen2.has(key)) { nextSeen2.add(key); nq.push({ r: nr, c: nc }); }
            });
          });
          q = nq;
        }

        room2.players[myId].movesMade = (room2.players[myId].movesMade || 0) + 1;
        if (!room2.firstRoundDone && order.every((id) => room2.players[id].movesMade >= 1)) room2.firstRoundDone = true;

        if (room2.firstRoundDone) {
          order.forEach((id) => {
            const p = room2.players[id];
            if (!p.alive) return;
            const hasOrbs = b.some((row) => row.some((cell) => cell.owner === id));
            if (!hasOrbs) p.alive = false;
          });
        }

        const alive = order.filter((id) => room2.players[id].alive);
        if (alive.length === 1 && room2.firstRoundDone) {
          room2.winnerId = alive[0];
        } else {
          let next = room2.currentPlayerIndex;
          for (let i = 0; i < order.length; i++) {
            next = (next + 1) % order.length;
            if (room2.players[order[next]].alive) { room2.currentPlayerIndex = next; break; }
          }
        }
        room2.board = b;
        return room2;
      });
    } catch (e) {
      console.error(e);
      showToast('Move failed to sync — reconnecting…');
    }

    animating = false;
  }

  // ---------- game over ----------
  function showGameOver() {
    const winner = room.players[room.winnerId];
    const col = winner ? COLORS[winner.colorIdx || 0] : COLORS[0];
    const orb = $('winnerOrb');
    orb.style.setProperty('--wc', col.hex);
    orb.style.setProperty('--wc-d', col.dark);
    $('winTitle').innerHTML = winner
      ? (room.winnerId === myId ? 'You win! 🎉' : `${escapeHtml(winner.name)} wins!`)
      : 'Game over';
    $('btnPlayAgain').classList.toggle('hidden', room.hostId !== myId);
    showScreen('screen-over');
    launchConfetti(col.hex);
  }

  $('btnPlayAgain').addEventListener('click', async () => {
    if (!room || room.hostId !== myId) return;
    boardBuilt = false;
    try {
      await roomRef(roomCode).transaction((r) => {
        if (!r) return;
        if (r.hostId !== myId) return r;
        r.board = emptyBoard();
        r.started = true;
        r.winnerId = null;
        r.currentPlayerIndex = 0;
        r.firstRoundDone = false;
        Object.keys(r.players).forEach((id) => { r.players[id].alive = true; r.players[id].movesMade = 0; });
        return r;
      });
    } catch (e) { console.error(e); showToast('Could not restart — try again.'); }
  });

  // ---------- confetti ----------
  function launchConfetti(hex) {
    const canvas = $('confettiCanvas');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colorsPool = COLORS.map((c) => c.hex);
    const particles = Array.from({ length: 120 }, () => ({
      x: canvas.width / 2, y: canvas.height * 0.3,
      vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 1.2) * 14,
      size: 3 + Math.random() * 4,
      color: Math.random() < 0.4 ? hex : colorsPool[Math.floor(Math.random() * colorsPool.length)],
      life: 90 + Math.random() * 40,
    }));
    let frame = 0;
    function tick() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.life--;
        ctx.globalAlpha = Math.max(p.life / 130, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      if (frame < 170) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    tick();
  }
  window.addEventListener('resize', () => {
    const canvas = $('confettiCanvas');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  });

  // ---------- boot: auto-rejoin if we were in a room ----------
  if (firebaseReady) {
    const savedRoom = localStorage.getItem('cr_room');
    if (savedRoom) subscribeRoom(savedRoom);
  }
})();
