(function () {
  const el = (id) => document.getElementById(id);
  const socket = io();

  let playerId = localStorage.getItem('ql_player_id') || null;
  let nickname = localStorage.getItem('ql_nickname') || '';
  let currentQuestionIndex = -1;
  let myLastChoice = null;
  let hasAnsweredCurrent = false;
  let questionTimerInterval = null;
  let questionDeadline = null;

  function showPanel(id) {
    document.querySelectorAll('.screen-panel').forEach((p) => p.classList.remove('show'));
    el(id).classList.add('show');
  }

  function showToast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (nickname) el('nicknameInput').value = nickname;

  el('joinBtn').addEventListener('click', doJoin);
  el('nicknameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  function doJoin() {
    const val = el('nicknameInput').value.trim();
    if (!val) { el('joinError').textContent = 'Scrivi un nome prima di entrare'; return; }
    nickname = val;
    localStorage.setItem('ql_nickname', nickname);
    socket.emit('join-game', { nickname, playerId });
  }

  socket.on('join:error', (e) => { el('joinError').textContent = e.message; });
  socket.on('join:ok', (p) => {
    playerId = p.playerId;
    localStorage.setItem('ql_player_id', playerId);
    el('lobbyNickname').textContent = nickname;
    if (currentQuestionIndex === -1) showPanel('panelLobby');
  });

  socket.on('init', (st) => {
    currentQuestionIndex = st.currentIndex;
    if (!playerId) { showPanel('panelJoin'); return; }
    switch (st.status) {
      case 'lobby':
        showPanel('panelLobby');
        break;
      case 'question':
        if (st.question) startQuestionUI(st.question, null);
        break;
      case 'reveal':
      case 'leaderboard':
        showPanel('panelLobby'); // riconnessione a metà: mostriamo semplice attesa
        break;
      case 'finished':
        showPanel('panelFinished');
        break;
      default:
        showPanel('panelLobby');
    }
  });

  socket.on('question:start', (payload) => {
    hasAnsweredCurrent = false;
    myLastChoice = null;
    startQuestionUI(payload.player, payload.startedAt);
  });

  function startQuestionUI(q, startedAt) {
    currentQuestionIndex = q.index;
    const optionCount = q.optionCount || (q.options ? q.options.length : 2);
    const grid = el('answerGrid');
    grid.innerHTML = '';
    const shapes = ['▲', '◆', '●', '■'];
    for (let i = 0; i < optionCount; i++) {
      const b = document.createElement('button');
      b.className = `answer-tile c${i}`;
      b.textContent = shapes[i] || '?';
      b.onclick = () => submitAnswer(i);
      grid.appendChild(b);
    }
    questionDeadline = (startedAt || Date.now()) + q.timeLimitSec * 1000;
    showPanel('panelQuestion');
    tickTimer();
    if (questionTimerInterval) clearInterval(questionTimerInterval);
    questionTimerInterval = setInterval(tickTimer, 250);
  }

  function tickTimer() {
    const remaining = Math.max(0, Math.round((questionDeadline - Date.now()) / 1000));
    el('questionTimer').textContent = remaining;
    if (remaining <= 0 && questionTimerInterval) {
      clearInterval(questionTimerInterval);
      questionTimerInterval = null;
    }
  }

  function submitAnswer(optionIndex) {
    if (hasAnsweredCurrent) return;
    hasAnsweredCurrent = true;
    myLastChoice = optionIndex;
    socket.emit('submit-answer', { playerId, questionIndex: currentQuestionIndex, optionIndex });
    showPanel('panelLocked');
  }

  socket.on('question:reveal', (payload) => {
    if (questionTimerInterval) { clearInterval(questionTimerInterval); questionTimerInterval = null; }
    const idx = payload.players.findIndex((p) => p.id === playerId);
    const me = idx >= 0 ? payload.players[idx] : null;
    const correct = myLastChoice === payload.correctIndex;
    el('revealIcon').textContent = correct ? '✅' : (myLastChoice == null ? '⌛' : '❌');
    el('revealText').textContent = myLastChoice == null ? 'Tempo scaduto' : (correct ? 'Risposta corretta!' : 'Risposta sbagliata');
    el('revealText').className = correct ? 'result-correct' : 'result-wrong';
    if (me) {
      el('revealPoints').textContent = `Punteggio totale: ${me.score}`;
      el('revealRank').textContent = `Posizione: ${idx + 1}°`;
    } else {
      el('revealPoints').textContent = '';
      el('revealRank').textContent = '';
    }
    showPanel('panelReveal');
  });

  socket.on('leaderboard:show', (payload) => {
    renderRankList('leaderboardList', payload.players);
    showPanel('panelLeaderboard');
  });

  socket.on('game:finished', (payload) => {
    renderRankList('finalList', payload.players.slice(0, 10));
    const idx = payload.players.findIndex((p) => p.id === playerId);
    const me = idx >= 0 ? payload.players[idx] : null;
    el('finalRank').textContent = me ? `${idx + 1}° posto · ${me.score} punti` : '';
    showPanel('panelFinished');
  });

  function renderRankList(elId, players) {
    const box = el(elId);
    box.innerHTML = '';
    players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'rank-row' + (p.id === playerId ? ' me' : '');
      row.innerHTML = `<span>${i + 1}. ${escapeHtml(p.nickname)}</span><span>${p.score}</span>`;
      box.appendChild(row);
    });
  }

  socket.on('reset', () => {
    localStorage.removeItem('ql_player_id');
    location.reload();
  });
})();
