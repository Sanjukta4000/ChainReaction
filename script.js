```javascript
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
      try {
        return crypto.randomUUID();
      } catch (e) {
        // fall through
      }
    }

    return 'p-' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36);
  }

  let myId = localStorage.getItem('cr_playerId');

  if (!myId) {
    myId = makeId();
    localStorage.setItem('cr_playerId', myId);
  }

  // ---------- state ----------
  let room = null;
  let roomCode = null;
  let roomListenerRef = null;
  let animating = false;
  let boardBuilt = false;

  const $ = (id) => document.getElementById(id);

  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const escapeHtml = (s) => {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  // ============================================================
  // BOARD HELPERS
  // ============================================================

  const cellCapacity = (r, c) => {
    let n = 0;

    if (r > 0) n++;
    if (r < ROWS - 1) n++;
    if (c > 0) n++;
    if (c < COLS - 1) n++;

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

  const deepCloneBoard = (b) => {
    return b.map((row) =>
      row.map((cell) => ({
        count: Number(cell?.count || 0),
        owner: cell?.owner ?? null
      }))
    );
  };

  const emptyBoard = () => {
    const b = [];

    for (let r = 0; r < ROWS; r++) {
      const row = [];

      for (let c = 0; c < COLS; c++) {
        row.push({
          count: 0,
          owner: null
        });
      }

      b.push(row);
    }

    return b;
  };

  const genCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

    let s = '';

    for (let i = 0; i < 4; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }

    return s;
  };

  function roomRef(code) {
    return db.ref('rooms/' + code);
  }

  function turnOrder(r) {
    return r.turnOrder || [];
  }

  function playerList(r) {
    return turnOrder(r).map((id) => ({
      id,
      ...(r.players ? r.players[id] : {})
    }));
  }

  function currentPlayer() {
    if (!room) return null;

    const order = turnOrder(room);
    const id = order[room.currentPlayerIndex];

    if (!id || !room.players || !room.players[id]) {
      return null;
    }

    return {
      id,
      ...room.players[id]
    };
  }

  // ============================================================
  // TOAST
  // ============================================================

  let toastTimer = null;

  function showToast(msg) {
    const el = $('toast');

    if (!el) return;

    el.textContent = msg;
    el.classList.add('show');

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 3600);
  }

  // ============================================================
  // CONNECTION STATUS
  // ============================================================

  function setConnStatus(kind, text) {
    const el = $('connStatus');

    if (!el) return;

    el.textContent = text;
    el.className = 'conn-status ' + kind;
  }

  if (!firebaseReady) {
    setConnStatus(
      'bad',
      'Firebase is not configured yet — see script.js'
    );
  } else {
    db.ref('.info/connected').on('value', (snap) => {
      const connected = snap.val() === true;

      setConnStatus(
        connected ? 'ok' : 'bad',
        connected ? 'Connected' : 'Reconnecting…'
      );
    });
  }

  // ============================================================
  // SCREENS
  // ============================================================

  function showScreen(id) {
    document
      .querySelectorAll('.screen')
      .forEach((s) => s.classList.remove('active'));

    const screen = $(id);

    if (screen) {
      screen.classList.add('active');
    }
  }

  function setError(msg) {
    const el = $('homeError');

    if (el) {
      el.textContent = msg || '';
    }
  }

  // ============================================================
  // SUBSCRIBING TO A ROOM
  // ============================================================

  function subscribeRoom(code) {
    unsubscribeRoom();

    roomCode = code;

    localStorage.setItem('cr_room', code);

    roomListenerRef = roomRef(code);

    roomListenerRef.on('value', (snap) => {
      const val = snap.val();

      if (!val) {
        room = null;

        localStorage.removeItem('cr_room');

        showToast('That room no longer exists.');

        showScreen('screen-home');

        return;
      }

      room = val;

      if (!room.players || !room.players[myId]) {
        return;
      }

      routeToCurrentScreen();
    });

    // Presence
    const connRef = db.ref('.info/connected');

    connRef.on('value', (snap) => {
      if (snap.val() === true) {
        const meRef = roomRef(code)
          .child('players')
          .child(myId)
          .child('connected');

        meRef.onDisconnect().set(false);

        meRef.set(true);
      }
    });
  }

  function unsubscribeRoom() {
    if (roomListenerRef) {
      roomListenerRef.off();
      roomListenerRef = null;
    }
  }

  // ============================================================
  // ROUTING
  // ============================================================

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

  // ============================================================
  // HOME SCREEN
  // ============================================================

  $('btnCreate').addEventListener('click', async () => {

    if (!firebaseReady) {
      showToast(
        'Firebase is not configured yet — see script.js'
      );
      return;
    }

    const name = $('nameInput').value.trim();

    if (!name) {
      setError('Enter your name first.');
      return;
    }

    setError('');

    localStorage.setItem('cr_name', name);

    $('btnCreate').disabled = true;

    try {

      let code;
      let exists = true;

      for (let i = 0; i < 5 && exists; i++) {
        code = genCode();

        const snap = await roomRef(code).once('value');

        exists = snap.exists();
      }

      const initial = {
        code,
        hostId: myId,
        started: false,
        winnerId: null,

        turnOrder: [myId],

        players: {
          [myId]: {
            name,
            colorIdx: 0,
            alive: true,
            movesMade: 0,
            connected: true
          }
        },

        board: null,
        currentPlayerIndex: 0,
        firstRoundDone: false,

        rows: ROWS,
        cols: COLS
      };

      await roomRef(code).set(initial);

      subscribeRoom(code);

    } catch (e) {

      console.error(e);

      showToast(
        'Could not create a room. Check your Firebase setup / internet connection.'
      );

    } finally {

      $('btnCreate').disabled = false;

    }
  });

  // ============================================================
  // JOIN ROOM
  // ============================================================

  $('btnJoin').addEventListener('click', async () => {

    if (!firebaseReady) {
      showToast(
        'Firebase is not configured yet — see script.js'
      );
      return;
    }

    const name = $('nameInput').value.trim();

    const code = $('codeInput')
      .value
      .trim()
      .toUpperCase();

    if (!name) {
      setError('Enter your name first.');
      return;
    }

    if (code.length !== 4) {
      setError('Room codes are 4 letters.');
      return;
    }

    setError('');

    localStorage.setItem('cr_name', name);

    $('btnJoin').disabled = true;

    try {

      console.log(
        '[join debug] looking up path:',
        'rooms/' + code,
        '| databaseURL:',
        FIREBASE_CONFIG.databaseURL
      );

      const precheck =
        await roomRef(code).once('value');

      console.log(
        '[join debug] exists:',
        precheck.exists(),
        '| value:',
        precheck.val()
      );

      if (!precheck.exists()) {
        setError('No room found with that code.');
        return;
      }

      const roomData = precheck.val();

      // Already in room
      if (
        roomData.players &&
        roomData.players[myId]
      ) {

        subscribeRoom(code);

        return;
      }

      // Game already started
      if (roomData.started) {
        setError(
          'That game has already started.'
        );
        return;
      }

      const existingOrder =
        roomData.turnOrder || [];

      if (existingOrder.length >= 6) {
        setError(
          'That room is full (6 players max).'
        );
        return;
      }

      // Pick unused colour
      const usedColors = new Set(
        Object.values(roomData.players || {})
          .map((p) => p.colorIdx)
      );

      let colorIdx = 0;

      while (
        usedColors.has(colorIdx) &&
        colorIdx < COLORS.length
      ) {
        colorIdx++;
      }

      if (colorIdx >= COLORS.length) {
        setError(
          'No player colors are available.'
        );
        return;
      }

      const updates = {};

      updates['players/' + myId] = {
        name,
        colorIdx,
        alive: true,
        movesMade: 0,
        connected: true
      };

      updates['turnOrder'] = [
        ...existingOrder,
        myId
      ];

      await roomRef(code).update(updates);

      subscribeRoom(code);

    } catch (e) {

      console.error(e);

      showToast(
        'Could not join. Check your Firebase setup / internet connection.'
      );

    } finally {

      $('btnJoin').disabled = false;

    }
  });

  // ============================================================
  // ROOM CODE INPUT
  // ============================================================

  $('codeInput').addEventListener(
    'input',
    (e) => {
      e.target.value =
        e.target.value
          .toUpperCase()
          .replace(/[^A-Z]/g, '');
    }
  );

  const savedName =
    localStorage.getItem('cr_name');

  if (savedName) {
    $('nameInput').value = savedName;
  }

  // ============================================================
  // LOBBY
  // ============================================================

  function renderLobby() {

    if (!room) return;

    $('lobbyCode').textContent =
      room.code;

    $('gameCode').textContent =
      room.code;

    const list =
      $('lobbyPlayers');

    list.innerHTML = '';

    playerList(room).forEach((p) => {

      const col =
        COLORS[p.colorIdx || 0];

      const div =
        document.createElement('div');

      div.className =
        'player-chip' +
        (p.connected === false
          ? ' offline'
          : '');

      div.innerHTML = `
        <span
          class="dot"
          style="background:${col.hex}; color:${col.hex};"
        ></span>

        <span class="name">
          ${escapeHtml(p.name || 'Player')}
        </span>

        ${
          p.id === myId
            ? '<span class="tagme">(you)</span>'
            : ''
        }

        ${
          p.id === room.hostId
            ? '<span class="host-badge">HOST</span>'
            : (
              p.connected === false
                ? '<span class="offline-badge">offline</span>'
                : ''
            )
        }
      `;

      list.appendChild(div);
    });

    const isHost =
      room.hostId === myId;

    $('lobbyHostControls')
      .classList
      .toggle(
        'hidden',
        !isHost
      );

    $('lobbyWaitNote')
      .classList
      .toggle(
        'hidden',
        isHost
      );

    $('btnStart').disabled =
      turnOrder(room).length < 2;
  }

  // ============================================================
  // START GAME
  // ============================================================

  $('btnStart').addEventListener(
    'click',
    async () => {

      if (
        !room ||
        room.hostId !== myId ||
        turnOrder(room).length < 2
      ) {
        return;
      }

      $('btnStart').disabled = true;

      try {

        await roomRef(roomCode)
          .transaction((r) => {

            if (!r) return;

            if (
              r.hostId !== myId ||
              r.started
            ) {
              return r;
            }

            if (
              (r.turnOrder || []).length < 2
            ) {
              return r;
            }

            r.board = emptyBoard();

            r.started = true;

            r.winnerId = null;

            r.currentPlayerIndex = 0;

            r.firstRoundDone = false;

            Object.keys(r.players)
              .forEach((id) => {

                r.players[id].alive = true;

                r.players[id].movesMade = 0;

              });

            return r;
          });

      } catch (e) {

        console.error(e);

        showToast(
          'Could not start the game — try again.'
        );

        $('btnStart').disabled = false;

      }
    }
  );

  // ============================================================
  // LEAVE BUTTONS
  // ============================================================

  $('btnLeaveLobby')
    .addEventListener(
      'click',
      leaveToHome
    );

  $('btnLeaveGame')
    .addEventListener(
      'click',
      leaveToHome
    );

  $('btnBackHome')
    .addEventListener(
      'click',
      leaveToHome
    );

  async function leaveToHome() {

    if (roomCode) {

      try {

        await roomRef(roomCode)
          .transaction((r) => {

            if (!r) return;

            if (r.players) {
              delete r.players[myId];
            }

            r.turnOrder =
              (r.turnOrder || [])
                .filter(
                  (id) => id !== myId
                );

            if (r.turnOrder.length === 0) {
              return null;
            }

            if (r.hostId === myId) {
              r.hostId =
                r.turnOrder[0];
            }

            if (
              r.currentPlayerIndex >=
              r.turnOrder.length
            ) {
              r.currentPlayerIndex = 0;
            }

            return r;

          });

      } catch (e) {

        console.error(e);

      }
    }

    unsubscribeRoom();

    localStorage.removeItem('cr_room');

    room = null;
    roomCode = null;
    boardBuilt = false;
    animating = false;

    $('codeInput').value = '';

    setError('');

    showScreen('screen-home');
  }

  // ============================================================
  // COPY ROOM CODE
  // ============================================================

  $('copyCode').addEventListener(
    'click',
    () => {

      if (!room) return;

      const code = room.code;

      if (
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {

        navigator.clipboard
          .writeText(code)
          .catch(() => fallbackCopy(code));

      } else {

        fallbackCopy(code);

      }

      const el = $('copyCode');

      const old =
        el.textContent;

      el.textContent =
        'Copied!';

      setTimeout(
        () => {
          el.textContent = old;
        },
        1200
      );
    }
  );

  function fallbackCopy(text) {

    const ta =
      document.createElement('textarea');

    ta.value = text;

    ta.style.position = 'fixed';
    ta.style.opacity = '0';

    document.body.appendChild(ta);

    ta.select();

    try {
      document.execCommand('copy');
    } catch (e) {}

    document.body.removeChild(ta);
  }

  // ============================================================
  // GAME SCREEN
  // ============================================================

  function buildBoardDomIfNeeded() {

    if (boardBuilt) return;

    const boardEl =
      $('board');

    boardEl.style.setProperty(
      '--rows',
      ROWS
    );

    boardEl.style.setProperty(
      '--cols',
      COLS
    );

    boardEl.style.gridTemplateRows =
      `repeat(${ROWS}, 1fr)`;

    boardEl.style.gridTemplateColumns =
      `repeat(${COLS}, 1fr)`;

    boardEl.innerHTML = '';

    for (let r = 0; r < ROWS; r++) {

      for (let c = 0; c < COLS; c++) {

        const cell =
          document.createElement('div');

        cell.className =
          'cell';

        cell.dataset.r = r;
        cell.dataset.c = c;

        cell.addEventListener(
          'click',
          onCellClick
        );

        boardEl.appendChild(cell);
      }
    }

    boardBuilt = true;
  }

  function renderGameIfBuilt() {

    if (
      room &&
      room.started
    ) {
      buildBoardDomIfNeeded();
      renderGame();
    }
  }

  // ============================================================
  // RENDER GAME
  // ============================================================

  function renderGame() {

    if (
      !room ||
      !room.board
    ) {
      return;
    }

    $('gameCode').textContent =
      room.code;

    const cp =
      currentPlayer();

    const banner =
      $('turnBanner');

    const isMine =
      cp &&
      cp.id === myId &&
      !room.winnerId;

    banner.classList.toggle(
      'mine',
      isMine
    );

    banner.style.color =
      cp
        ? COLORS[cp.colorIdx || 0].hex
        : '';

    banner.textContent =
      room.winnerId
        ? 'Game over'
        : (
          isMine
            ? 'Your turn — pick a cell'
            : `${cp ? cp.name : '...'}'s turn`
        );

    const strip =
      $('playersStrip');

    strip.innerHTML = '';

    playerList(room)
      .forEach((p, idx) => {

        const col =
          COLORS[p.colorIdx || 0];

        const chip =
          document.createElement('div');

        chip.className =
          'pchip' +
          (
            idx === room.currentPlayerIndex &&
            !room.winnerId
              ? ' active-turn'
              : ''
          ) +
          (
            !p.alive
              ? ' eliminated'
              : ''
          ) +
          (
            p.connected === false
              ? ' offline'
              : ''
          );

        chip.style.color =
          idx === room.currentPlayerIndex
            ? col.hex
            : '';

        chip.innerHTML = `
          <span
            class="dot"
            style="background:${col.hex}; color:${col.hex};"
          ></span>
          ${escapeHtml(p.name || 'Player')}
          ${p.id === myId ? ' (you)' : ''}
        `;

        strip.appendChild(chip);
      });

    for (let r = 0; r < ROWS; r++) {

      for (let c = 0; c < COLS; c++) {

        const cellData =
          room.board[r]?.[c] || {
            count: 0,
            owner: null
          };

        renderCell(
          r,
          c,
          cellData
        );
      }
    }
  }

  // ============================================================
  // RENDER INDIVIDUAL CELL
  // ============================================================

  function renderCell(r, c, cellData) {

    const el =
      document.querySelector(
        `.cell[data-r="${r}"][data-c="${c}"]`
      );

    if (!el || !cellData) {
      return;
    }

    // Firebase may remove "owner: null".
    // Therefore owner can be null OR undefined.
    const owner =
      cellData.owner ?? null;

    const count =
      Number(cellData.count || 0);

    const cap =
      cellCapacity(r, c);

    const cp =
      currentPlayer();

    // IMPORTANT FIX:
    // owner == null accepts both null and undefined.
    const clickable =
      room.started &&
      !room.winnerId &&
      cp &&
      cp.id === myId &&
      (owner == null || owner === myId) &&
      !animating;

    el.classList.toggle(
      'clickable',
      !!clickable
    );

    const isDanger =
      count === cap - 1 &&
      owner != null;

    el.classList.toggle(
      'danger',
      isDanger
    );

    if (
      owner != null &&
      room.players &&
      room.players[owner]
    ) {

      const col =
        COLORS[
          room.players[owner].colorIdx || 0
        ];

      el.style.setProperty(
        '--cell-glow',
        col.hex + '99'
      );

    } else {

      el.style.removeProperty(
        '--cell-glow'
      );
    }

    el.innerHTML = '';

    if (count <= 0) {
      return;
    }

    const ownerData =
      room.players &&
      owner != null
        ? room.players[owner]
        : null;

    const col =
      ownerData
        ? COLORS[ownerData.colorIdx || 0]
        : COLORS[0];

    const positions =
      count === 1
        ? ['o1']
        : count === 2
          ? ['o2a', 'o2b']
          : ['o3a', 'o3b', 'o3c'];

    positions.forEach(
      (posClass) => {

        const orb =
          document.createElement('div');

        orb.className =
          'orb ' + posClass;

        orb.style.setProperty(
          '--oc',
          col.hex
        );

        orb.style.setProperty(
          '--oc-d',
          col.dark
        );

        el.appendChild(orb);
      }
    );
  }

  // ============================================================
  // BURST ANIMATION
  // ============================================================

  function burstAt(r, c, hex) {

    const el =
      document.querySelector(
        `.cell[data-r="${r}"][data-c="${c}"]`
      );

    if (!el) return;

    const ring =
      document.createElement('div');

    ring.className =
      'burst-ring';

    ring.style.setProperty(
      '--bc',
      hex
    );

    el.appendChild(ring);

    setTimeout(
      () => ring.remove(),
      520
    );
  }

  // ============================================================
  // LOCAL BOARD SIMULATION
  // ============================================================

  function simulateMove(
    sourceBoard,
    r,
    c,
    playerId,
    playerColor
  ) {

    const board =
      deepCloneBoard(sourceBoard);

    // Add orb to selected cell
    board[r][c].count =
      Number(board[r][c].count || 0) + 1;

    board[r][c].owner =
      playerId;

    let queue = [{ r, c }];

    let safety = 0;

    while (
      queue.length &&
      safety < 400
    ) {

      safety++;

      const seen =
        new Set();

      const toExplode = [];

      queue.forEach(
        (cell) => {

          const key =
            cell.r + '-' + cell.c;

          if (seen.has(key)) return;

          seen.add(key);

          if (
            board[cell.r][cell.c].count >=
            cellCapacity(cell.r, cell.c)
          ) {
            toExplode.push(cell);
          }
        }
      );

      if (
        toExplode.length === 0
      ) {
        break;
      }

      toExplode.forEach(
        (cell) => {
          burstAt(
            cell.r,
            cell.c,
            playerColor
          );
        }
      );

      const nextSeen =
        new Set();

      const nextQueue = [];

      toExplode.forEach(
        (cell) => {

          const cap =
            cellCapacity(
              cell.r,
              cell.c
            );

          board[cell.r][cell.c].count -= cap;

          if (
            board[cell.r][cell.c].count <= 0
          ) {

            board[cell.r][cell.c].count = 0;

            board[cell.r][cell.c].owner = null;
          }

          neighbors(
            cell.r,
            cell.c
          ).forEach(
            ([nr, nc]) => {

              board[nr][nc].count =
                Number(
                  board[nr][nc].count || 0
                ) + 1;

              board[nr][nc].owner =
                playerId;

              const key =
                nr + '-' + nc;

              if (
                !nextSeen.has(key)
              ) {

                nextSeen.add(key);

                nextQueue.push({
                  r: nr,
                  c: nc
                });

              }
            }
          );
        }
      );

      toExplode.forEach(
        (cell) => {

          renderCell(
            cell.r,
            cell.c,
            board[cell.r][cell.c]
          );

        }
      );

      nextQueue.forEach(
        (cell) => {

          renderCell(
            cell.r,
            cell.c,
            board[cell.r][cell.c]
          );

        }
      );

      queue = nextQueue;
    }

    return board;
  }

  // ============================================================
  // MOVE HANDLING
  // ============================================================

  async function onCellClick(e) {

    if (
      animating ||
      !room ||
      !room.started ||
      room.winnerId
    ) {
      return;
    }

    const r =
      parseInt(
        e.currentTarget.dataset.r,
        10
      );

    const c =
      parseInt(
        e.currentTarget.dataset.c,
        10
      );

    const cp =
      currentPlayer();

    if (
      !cp ||
      cp.id !== myId
    ) {
      return;
    }

    const cellData =
      room.board[r]?.[c] || {
        count: 0,
        owner: null
      };

    // IMPORTANT FIX:
    // Firebase can return undefined for an empty owner.
    const owner =
      cellData.owner ?? null;

    if (
      !(owner == null || owner === myId)
    ) {
      return;
    }

    animating = true;

    try {

      // --------------------------------------------------------
      // LOCAL OPTIMISTIC ANIMATION
      // --------------------------------------------------------

      const board =
        deepCloneBoard(room.board);

      board[r][c].count =
        Number(board[r][c].count || 0) + 1;

      board[r][c].owner =
        myId;

      renderCell(
        r,
        c,
        board[r][c]
      );

      const myCol =
        COLORS[cp.colorIdx || 0];

      // Simulate locally
      simulateMove(
        board,
        r,
        c,
        myId,
        myCol.hex
      );

      // --------------------------------------------------------
      // AUTHORITATIVE FIREBASE TRANSACTION
      // --------------------------------------------------------

      await roomRef(roomCode)
        .transaction((room2) => {

          if (
            !room2 ||
            !room2.started ||
            room2.winnerId
          ) {
            return;
          }

          const order =
            room2.turnOrder || [];

          const cpId =
            order[
              room2.currentPlayerIndex
            ];

          // Stale client / wrong turn
          if (
            cpId !== myId
          ) {
            return;
          }

          // Make sure board exists
          if (
            !room2.board
          ) {
            room2.board =
              emptyBoard();
          }

          // Make sure selected cell exists
          if (
            !room2.board[r]
          ) {
            room2.board[r] = [];
          }

          if (
            !room2.board[r][c]
          ) {
            room2.board[r][c] = {
              count: 0,
              owner: null
            };
          }

          const cd =
            room2.board[r][c];

          const cdOwner =
            cd.owner ?? null;

          // IMPORTANT FIX
          if (
            !(cdOwner == null || cdOwner === myId)
          ) {
            return;
          }

          let b =
            room2.board;

          // ----------------------------------------------------
          // ADD ORB
          // ----------------------------------------------------

          b[r][c].count =
            Number(
              b[r][c].count || 0
            ) + 1;

          b[r][c].owner =
            myId;

          // ----------------------------------------------------
          // CHAIN REACTION
          // ----------------------------------------------------

          let q = [{ r, c }];

          let s2 = 0;

          while (
            q.length &&
            s2 < 400
          ) {

            s2++;

            const seen2 =
              new Set();

            const explode = [];

            q.forEach(
              (cell) => {

                const key =
                  cell.r + '-' + cell.c;

                if (
                  seen2.has(key)
                ) {
                  return;
                }

                seen2.add(key);

                if (
                  b[cell.r][cell.c].count >=
                  cellCapacity(
                    cell.r,
                    cell.c
                  )
                ) {
                  explode.push(cell);
                }
              }
            );

            if (
              explode.length === 0
            ) {
              break;
            }

            const nextSeen2 =
              new Set();

            const nq = [];

            explode.forEach(
              (cell) => {

                const cap =
                  cellCapacity(
                    cell.r,
                    cell.c
                  );

                b[cell.r][cell.c].count -=
                  cap;

                if (
                  b[cell.r][cell.c].count <= 0
                ) {

                  b[cell.r][cell.c].count = 0;

                  b[cell.r][cell.c].owner = null;

                }

                neighbors(
                  cell.r,
                  cell.c
                ).forEach(
                  ([nr, nc]) => {

                    if (
                      !b[nr][nc]
                    ) {
                      b[nr][nc] = {
                        count: 0,
                        owner: null
                      };
                    }

                    b[nr][nc].count =
                      Number(
                        b[nr][nc].count || 0
                      ) + 1;

                    b[nr][nc].owner =
                      myId;

                    const key =
                      nr + '-' + nc;

                    if (
                      !nextSeen2.has(key)
                    ) {

                      nextSeen2.add(key);

                      nq.push({
                        r: nr,
                        c: nc
                      });

                    }
                  }
                );
              }
            );

            q = nq;
          }

          // ----------------------------------------------------
          // UPDATE MOVE COUNT
          // ----------------------------------------------------

          if (
            !room2.players ||
            !room2.players[myId]
          ) {
            return;
          }

          room2.players[myId].movesMade =
            (
              room2.players[myId].movesMade || 0
            ) + 1;

          // ----------------------------------------------------
          // FIRST ROUND
          // ----------------------------------------------------

          if (
            !room2.firstRoundDone &&
            order.every(
              (id) =>
                room2.players[id] &&
                room2.players[id].movesMade >= 1
            )
          ) {

            room2.firstRoundDone =
              true;
          }

          // ----------------------------------------------------
          // ELIMINATION
          // ----------------------------------------------------

          if (
            room2.firstRoundDone
          ) {

            order.forEach(
              (id) => {

                const p =
                  room2.players[id];

                if (
                  !p ||
                  !p.alive
                ) {
                  return;
                }

                const hasOrbs =
                  b.some(
                    (row) =>
                      row.some(
                        (cell) =>
                          cell.owner === id &&
                          Number(cell.count || 0) > 0
                      )
                  );

                if (
                  !hasOrbs
                ) {
                  p.alive = false;
                }
              }
            );
          }

          // ----------------------------------------------------
          // WINNER
          // ----------------------------------------------------

          const alive =
            order.filter(
              (id) =>
                room2.players[id] &&
                room2.players[id].alive
            );

          if (
            alive.length === 1 &&
            room2.firstRoundDone
          ) {

            room2.winnerId =
              alive[0];

          } else {

            // --------------------------------------------------
            // NEXT PLAYER
            // --------------------------------------------------

            let next =
              room2.currentPlayerIndex;

            for (
              let i = 0;
              i < order.length;
              i++
            ) {

              next =
                (
                  next + 1
                ) % order.length;

              const nextPlayer =
                room2.players[
                  order[next]
                ];

              if (
                nextPlayer &&
                nextPlayer.alive
              ) {

                room2.currentPlayerIndex =
                  next;

                break;
              }
            }
          }

          room2.board =
            b;

          return room2;
        });

    } catch (e) {

      console.error(e);

      showToast(
        'Move failed to sync — reconnecting…'
      );

    } finally {

      animating = false;

      // Render the authoritative state
      // after the transaction completes.
      if (
        room &&
        room.started
      ) {
        renderGame();
      }
    }
  }

  // ============================================================
  // GAME OVER
  // ============================================================

  function showGameOver() {

    if (
      !room ||
      !room.winnerId ||
      !room.players
    ) {
      return;
    }

    const winner =
      room.players[
        room.winnerId
      ];

    const col =
      winner
        ? COLORS[winner.colorIdx || 0]
        : COLORS[0];

    const orb =
      $('winnerOrb');

    orb.style.setProperty(
      '--wc',
      col.hex
    );

    orb.style.setProperty(
      '--wc-d',
      col.dark
    );

    $('winTitle').innerHTML =
      winner
        ? (
          room.winnerId === myId
            ? 'You win! 🎉'
            : `${escapeHtml(winner.name)} wins!`
        )
        : 'Game over';

    $('btnPlayAgain')
      .classList
      .toggle(
        'hidden',
        room.hostId !== myId
      );

    showScreen(
      'screen-over'
    );

    launchConfetti(
      col.hex
    );
  }

  // ============================================================
  // PLAY AGAIN
  // ============================================================

  $('btnPlayAgain')
    .addEventListener(
      'click',
      async () => {

        if (
          !room ||
          room.hostId !== myId
        ) {
          return;
        }

        boardBuilt = false;

        try {

          await roomRef(roomCode)
            .transaction((r) => {

              if (!r) return;

              if (
                r.hostId !== myId
              ) {
                return r;
              }

              r.board =
                emptyBoard();

              r.started =
                true;

              r.winnerId =
                null;

              r.currentPlayerIndex =
                0;

              r.firstRoundDone =
                false;

              Object.keys(r.players)
                .forEach((id) => {

                  r.players[id].alive =
                    true;

                  r.players[id].movesMade =
                    0;

                });

              return r;

            });

        } catch (e) {

          console.error(e);

          showToast(
            'Could not restart — try again.'
          );

        }
      }
    );

  // ============================================================
  // CONFETTI
  // ============================================================

  function launchConfetti(hex) {

    const canvas =
      $('confettiCanvas');

    canvas.width =
      window.innerWidth;

    canvas.height =
      window.innerHeight;

    const ctx =
      canvas.getContext('2d');

    const colorsPool =
      COLORS.map(
        (c) => c.hex
      );

    const particles =
      Array.from(
        { length: 120 },
        () => ({
          x: canvas.width / 2,
          y: canvas.height * 0.3,

          vx:
            (Math.random() - 0.5) * 14,

          vy:
            (Math.random() - 1.2) * 14,

          size:
            3 + Math.random() * 4,

          color:
            Math.random() < 0.4
              ? hex
              : colorsPool[
                Math.floor(
                  Math.random() *
                  colorsPool.length
                )
              ],

          life:
            90 +
            Math.random() * 40
        })
      );

    let frame = 0;

    function tick() {

      frame++;

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      particles.forEach(
        (p) => {

          p.vy += 0.28;

          p.x += p.vx;

          p.y += p.vy;

          p.life--;

          ctx.globalAlpha =
            Math.max(
              p.life / 130,
              0
            );

          ctx.fillStyle =
            p.color;

          ctx.beginPath();

          ctx.arc(
            p.x,
            p.y,
            p.size,
            0,
            Math.PI * 2
          );

          ctx.fill();

        }
      );

      ctx.globalAlpha = 1;

      if (
        frame < 170
      ) {

        requestAnimationFrame(
          tick
        );

      } else {

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );
      }
    }

    tick();
  }

  window.addEventListener(
    'resize',
    () => {

      const canvas =
        $('confettiCanvas');

      if (!canvas) return;

      canvas.width =
        window.innerWidth;

      canvas.height =
        window.innerHeight;
    }
  );

  // ============================================================
  // BOOT
  // ============================================================

  if (firebaseReady) {

    const savedRoom =
      localStorage.getItem('cr_room');

    if (savedRoom) {
      subscribeRoom(savedRoom);
    }
  }

})();
```
