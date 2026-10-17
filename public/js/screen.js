(function () {
  const el = (id) => document.getElementById(id);
  const socket = io();
  const SHAPES = ['▲', '◆', '●', '■'];

  let state = { status: 'lobby', players: [] };
  let qTimerInterval = null;

  function showView(id) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('show'));
    el(id).classList.add('show');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderLobbyPlayers(players) {
    el('playerCount').textContent = `${players.length} giocator${players.length === 1 ? 'e' : 'i'} connessi`;
    const grid = el('playerGrid');
    grid.innerHTML = '';
    players.forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      chip.textContent = p.nickname;
      grid.appendChild(chip);
    });
  }

  function renderRankList(elId, players) {
    const box = el(elId);
    box.innerHTML = '';
    players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (i === 0 ? ' top1' : '');
      row.innerHTML = `<span class="pos">${i + 1}°</span><span class="name">${escapeHtml(p.nickname)}</span><span>${p.score}</span>`;
      box.appendChild(row);
    });
  }

  socket.on('init', (st) => {
    state = st;
    el('quizTitleText').textContent = st.quizTitle || '—';
    el('lobbyQuizTitle').textContent = st.quizTitle || 'Quiz Live';
    if (st.questionCount) el('progressText').textContent = `${Math.max(0, st.currentIndex + 1)}/${st.questionCount} domande`;
    renderLobbyPlayers(st.players || []);
    if (st.status === 'lobby') showView('viewLobby');
    else if (st.status === 'question' && st.question) renderQuestion(st.question, null);
    else if (st.status === 'finished') showView('viewFinished');
    else showView('viewLobby');
  });

  socket.on('players:update', (p) => renderLobbyPlayers(p.players));

  socket.on('question:start', (payload) => {
    const q = payload.screen;
    el('progressText').textContent = `${q.index + 1}/${q.total} domande`;
    renderQuestion(q, payload.startedAt);
  });

  // Separata dal timer: serve anche per aggiornare solo il testo quando l'admin cambia la
  // lingua del maxischermo a metà di una domanda già partita, senza toccare il conto alla rovescia.
  function renderQuestionContent(q) {
    el('qText').textContent = q.text || '';
    const hints = { multi: 'Selezione multipla: puoi scegliere più risposte', mc: 'Scelta singola: una sola risposta corretta', tf: 'Vero o Falso' };
    el('qHint').textContent = hints[q.type] || '';
    const box = el('qAnswers');
    box.innerHTML = '';
    (q.options || []).forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = `q-answer c${i}`;
      div.innerHTML = `<span class="shape">${SHAPES[i] || '?'}</span><span>${escapeHtml(opt)}</span>`;
      box.appendChild(div);
    });
  }

  function renderQuestion(q, startedAt) {
    renderQuestionContent(q);
    el('qProgress').textContent = '';
    showView('viewQuestion');

    if (qTimerInterval) clearInterval(qTimerInterval);
    const deadline = (startedAt || Date.now()) + q.timeLimitSec * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      el('qTimer').textContent = remaining;
      if (remaining <= 0 && qTimerInterval) { clearInterval(qTimerInterval); qTimerInterval = null; }
    };
    tick();
    qTimerInterval = setInterval(tick, 250);
  }

  // L'admin ha cambiato la lingua del maxischermo: se c'è una domanda attiva, ne aggiorniamo
  // solo il contenuto (il timer, già in corso, non viene toccato).
  socket.on('screen-lang:update', (payload) => {
    if (payload.question) renderQuestionContent(payload.question);
  });

  socket.on('answers:count', (p) => {
    el('qProgress').textContent = `${p.count} / ${p.total} hanno risposto`;
  });

  socket.on('question:reveal', (payload) => {
    if (qTimerInterval) { clearInterval(qTimerInterval); qTimerInterval = null; }
    const correctSet = new Set(payload.correctIndexes != null ? payload.correctIndexes : [payload.correctIndex]);
    const correctLabel = payload.options
      .map((opt, i) => (correctSet.has(i) ? `${SHAPES[i] || ''} ${opt}` : null))
      .filter(Boolean)
      .join('  ·  ');
    el('revealCorrectText').textContent = `Risposta corretta: ${correctLabel}`;
    const bars = el('revealBars');
    bars.innerHTML = '';
    const maxCount = Math.max(1, ...payload.counts);
    payload.options.forEach((opt, i) => {
      const count = payload.counts[i] || 0;
      const pct = Math.round((count / maxCount) * 100);
      const row = document.createElement('div');
      row.className = 'reveal-bar-row';
      row.innerHTML = `
        <div class="reveal-bar-label">${SHAPES[i] || ''} ${escapeHtml(opt)}${correctSet.has(i) ? ' ✓' : ''}</div>
        <div class="reveal-bar-track"><div class="reveal-bar-fill c${i}" style="width:0%"></div></div>
        <div class="reveal-bar-count">${count}</div>
      `;
      bars.appendChild(row);
      const fill = row.querySelector('.reveal-bar-fill');
      requestAnimationFrame(() => { fill.style.width = pct + '%'; });
    });
    showView('viewReveal');
  });

  socket.on('leaderboard:show', (payload) => {
    renderRankList('lbList', payload.players);
    showView('viewLeaderboard');
  });

  socket.on('game:finished', (payload) => {
    renderRankList('finalList', payload.players.slice(0, 10));
    showView('viewFinished');
  });

  socket.on('reset', () => location.reload());
})();
