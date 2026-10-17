(function () {
  const el = (id) => document.getElementById(id);
  const socket = io();
  const LANGS = ['it', 'de', 'fr', 'es', 'en'];

  let lang = localStorage.getItem('ql_lang') || window.detectLang();
  let playerId = localStorage.getItem('ql_player_id') || null;
  let nickname = localStorage.getItem('ql_nickname') || '';
  let currentQuestionIndex = -1;
  let myLastChoice = null;
  let myLastChoices = null; // per le domande a selezione multipla
  let hasAnsweredCurrent = false;
  let questionTimerInterval = null;
  let questionDeadline = null;
  let multiSelected = null; // Set delle opzioni toccate, solo per il tipo 'multi'
  let multiSubmitted = false;
  let lastReveal = null; // riapplicato se si cambia lingua mentre il reveal è a schermo
  let currentQuestionData = null; // riapplicato se si cambia lingua mentre una domanda è attiva
  let mySummary = null; // risposte e risultato di tutte le domande, per il PDF scaricabile

  function T(key) { return window.t(lang, key); }

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

  // ---------- Lingua ----------
  function renderLangSwitch() {
    const box = el('langSwitch');
    box.innerHTML = '';
    LANGS.forEach((l) => {
      const b = document.createElement('button');
      b.textContent = l.toUpperCase();
      if (l === lang) b.classList.add('active');
      b.onclick = () => { lang = l; localStorage.setItem('ql_lang', l); applyTranslations(); renderLangSwitch(); };
      box.appendChild(b);
    });
  }

  function applyTranslations() {
    document.documentElement.lang = lang;
    el('joinTitleText').textContent = T('joinTitle');
    el('nicknameInput').placeholder = T('nicknamePlaceholder');
    el('joinBtn').textContent = T('joinBtn');
    el('lobbyTitleText').textContent = T('lobbyTitle');
    el('lobbyWaitTextEl').textContent = T('lobbyWaitText');
    el('lockedTitleText').textContent = T('lockedTitle');
    el('lockedSubtitleText').textContent = T('lockedSubtitle');
    el('leaderboardTitleText').textContent = T('leaderboardTitle');
    el('finishedTitleText').textContent = T('finishedTitle');
    el('downloadSummaryBtn').textContent = T('downloadSummaryBtn');
    if (currentQuestionData) renderQuestionTexts(currentQuestionData); // ri-traduce la domanda attiva, se c'è
    if (lastReveal) renderReveal(lastReveal); // ri-traduce il reveal se già visibile
  }

  if (nickname) el('nicknameInput').value = nickname;

  el('joinBtn').addEventListener('click', doJoin);
  el('nicknameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  function doJoin() {
    const val = el('nicknameInput').value.trim();
    if (!val) { el('joinError').textContent = T('joinErrorEmpty'); return; }
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
        socket.emit('request-my-summary'); // riconnessione dopo la fine: recupera comunque il riepilogo
        break;
      default:
        showPanel('panelLobby');
    }
  });

  socket.on('question:start', (payload) => {
    hasAnsweredCurrent = false;
    myLastChoice = null;
    myLastChoices = null;
    lastReveal = null;
    startQuestionUI(payload.player, payload.startedAt);
  });

  function startQuestionUI(q, startedAt) {
    currentQuestionIndex = q.index;
    currentQuestionData = q;
    const optionCount = q.optionCount || (q.options ? q.options.length : 2);
    const grid = el('answerGrid');
    grid.innerHTML = '';
    const shapes = ['▲', '◆', '●', '■'];
    const isMulti = q.type === 'multi';
    multiSelected = isMulti ? new Set() : null;
    multiSubmitted = false;
    for (let i = 0; i < optionCount; i++) {
      const b = document.createElement('button');
      b.className = `answer-tile c${i}`;
      b.innerHTML = `<span class="shape">${shapes[i] || '?'}</span><span class="label" data-idx="${i}"></span>`;
      b.onclick = () => (isMulti ? toggleMultiOption(b, i) : submitAnswer(i));
      grid.appendChild(b);
    }
    renderQuestionTexts(q);
    questionDeadline = (startedAt || Date.now()) + q.timeLimitSec * 1000;
    showPanel('panelQuestion');
    tickTimer();
    if (questionTimerInterval) clearInterval(questionTimerInterval);
    questionTimerInterval = setInterval(tickTimer, 250);
  }

  // Testo della domanda e delle opzioni nella lingua del partecipante (con ripiego in
  // italiano se manca una traduzione) — richiamata anche quando si cambia lingua a domanda
  // già in corso, per non perdere la selezione fatta finora.
  function renderQuestionTexts(q) {
    const text = (q.textByLang && (q.textByLang[lang] || q.textByLang.it)) || '';
    const opts = (q.optionsByLang && (q.optionsByLang[lang] || q.optionsByLang.it)) || [];
    el('questionText').textContent = text;
    document.querySelectorAll('#answerGrid .answer-tile .label').forEach((node) => {
      const i = Number(node.dataset.idx);
      node.textContent = opts[i] || '';
    });
    // Sempre visibile: altrimenti non si capisce se si può scegliere una sola risposta o più.
    const hintKey = q.type === 'multi' ? 'multiHintText' : (q.type === 'tf' ? 'trueFalseHintText' : 'singleChoiceHintText');
    el('questionModeHint').textContent = T(hintKey);
  }

  // Selezione multipla: ogni tocco accende/spegne l'opzione, nessun invio immediato.
  // La risposta (anche se vuota) parte da sola allo scadere del tempo — niente bonus di velocità.
  function toggleMultiOption(btn, i) {
    if (multiSubmitted) return;
    if (multiSelected.has(i)) { multiSelected.delete(i); btn.classList.remove('selected'); }
    else { multiSelected.add(i); btn.classList.add('selected'); }
  }

  function submitMultiAnswer() {
    if (multiSubmitted) return;
    multiSubmitted = true;
    myLastChoices = Array.from(multiSelected || []);
    socket.emit('submit-answer', { playerId, questionIndex: currentQuestionIndex, optionIndexes: myLastChoices });
    showPanel('panelLocked');
  }

  function tickTimer() {
    const remaining = Math.max(0, Math.round((questionDeadline - Date.now()) / 1000));
    el('questionTimer').textContent = remaining;
    if (remaining <= 0) {
      if (questionTimerInterval) { clearInterval(questionTimerInterval); questionTimerInterval = null; }
      if (multiSelected && !multiSubmitted) submitMultiAnswer();
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
    lastReveal = payload;
    renderReveal(payload);
    showPanel('panelReveal');
  });

  function renderReveal(payload) {
    const idx = payload.players.findIndex((p) => p.id === playerId);
    const me = idx >= 0 ? payload.players[idx] : null;
    let correct, noAnswer;
    if (payload.correctIndexes) {
      // Selezione multipla: l'invio parte sempre da sola allo scadere del tempo, quindi non
      // esiste un vero "tempo scaduto senza risposta" come nelle domande a scelta singola.
      const chosen = myLastChoices || [];
      const correctSet = payload.correctIndexes;
      correct = chosen.length === correctSet.length && correctSet.every((i) => chosen.includes(i));
      noAnswer = false;
    } else {
      correct = myLastChoice === payload.correctIndex;
      noAnswer = myLastChoice == null;
    }
    el('revealIcon').textContent = correct ? '✅' : (noAnswer ? '⌛' : '❌');
    el('revealText').textContent = noAnswer ? T('resultTimeout') : (correct ? T('resultCorrect') : T('resultWrong'));
    el('revealText').className = correct ? 'result-correct' : 'result-wrong';
    if (me) {
      el('revealPoints').textContent = `${T('totalScoreLabel')}: ${me.score}`;
      el('revealRank').textContent = `${T('rankLabel')}: ${idx + 1}°`;
    } else {
      el('revealPoints').textContent = '';
      el('revealRank').textContent = '';
    }
  }

  socket.on('leaderboard:show', (payload) => {
    renderRankList('leaderboardList', payload.players);
    showPanel('panelLeaderboard');
  });

  socket.on('game:finished', (payload) => {
    renderRankList('finalList', payload.players.slice(0, 10));
    const idx = payload.players.findIndex((p) => p.id === playerId);
    const me = idx >= 0 ? payload.players[idx] : null;
    el('finalRank').textContent = me ? T('finalRankTemplate').replace('{rank}', idx + 1).replace('{score}', me.score) : '';
    showPanel('panelFinished');
    el('downloadSummaryBtn').style.display = 'none';
    socket.emit('request-my-summary');
  });

  socket.on('my-summary', (data) => {
    mySummary = data;
    el('downloadSummaryBtn').style.display = 'block';
  });

  el('downloadSummaryBtn').addEventListener('click', downloadSummaryPdf);

  // Un'opzione per domanda a scelta singola/Vero-Falso, più opzioni per selezione multipla.
  function formatMyAnswer(item, opts) {
    if (!item.answered) return '—';
    if (Array.isArray(item.myOptionIndexes)) {
      const labels = item.myOptionIndexes.map((i) => opts[i]).filter(Boolean);
      return labels.length ? labels.join(', ') : '—';
    }
    return item.myOptionIndex != null && opts[item.myOptionIndex] != null ? opts[item.myOptionIndex] : '—';
  }

  function downloadSummaryPdf() {
    if (!mySummary || !window.jspdf) { showToast(T('pdfUnavailable')); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 20;
    const ensureSpace = () => { if (y > pageHeight - 20) { doc.addPage(); y = 20; } };
    const writeLine = (text, size, bold) => {
      doc.setFontSize(size || 11);
      doc.setFont(undefined, bold ? 'bold' : 'normal');
      doc.splitTextToSize(text, pageWidth - margin * 2).forEach((line) => {
        ensureSpace();
        doc.text(line, margin, y);
        y += 7;
      });
    };

    writeLine(mySummary.quizTitle || 'Quiz', 18, true);
    writeLine(`${mySummary.nickname} — ${T('totalScoreLabel')}: ${mySummary.totalScore}`, 12);
    y += 4;

    mySummary.items.forEach((item, i) => {
      const qText = (item.textByLang && (item.textByLang[lang] || item.textByLang.it)) || '';
      const opts = (item.optionsByLang && (item.optionsByLang[lang] || item.optionsByLang.it)) || [];
      ensureSpace();
      writeLine(`${i + 1}. ${qText}`, 12, true);
      writeLine(`${T('yourAnswerLabel')}: ${formatMyAnswer(item, opts)}`, 10);
      const resultLabel = !item.answered ? T('resultTimeout') : (item.correct ? T('resultCorrect') : T('resultWrong'));
      writeLine(`${resultLabel} — ${item.points} ${T('pointsSuffix')}`, 10);
      y += 3;
    });

    const safeTitle = (mySummary.quizTitle || 'quiz').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    doc.save(`${safeTitle}-${mySummary.nickname}-riepilogo.pdf`);
  }

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

  // ---- init ----
  renderLangSwitch();
  applyTranslations();
})();
