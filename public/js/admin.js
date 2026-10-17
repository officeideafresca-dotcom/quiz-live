(function () {
  const el = (id) => document.getElementById(id);
  const socket = io();

  let state = null;
  let pin = localStorage.getItem('ql_admin_pin') || '';
  let questionSeq = 0;

  function sendAdmin(action, payload) {
    socket.emit('admin', { pin, action, payload });
  }

  // ---------- PIN ----------
  function unlock() {
    pin = el('pinInput').value.trim();
    if (!pin) return;
    localStorage.setItem('ql_admin_pin', pin);
    el('pinBox').style.display = 'none';
    el('controls').style.display = 'flex';
    el('pinError').textContent = '';
    sendAdmin('get-quiz');
  }
  el('btnUnlock').addEventListener('click', unlock);
  el('pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  if (pin) { el('pinBox').style.display = 'none'; el('controls').style.display = 'flex'; sendAdmin('get-quiz'); }

  // Le domande esistenti sul server (incluse le risposte corrette) arrivano solo qui,
  // mai nell'evento 'init' condiviso con schermo/partecipanti.
  socket.on('admin:quiz-data', (data) => {
    el('quizTitleInput').value = data.title || '';
    document.querySelector(`input[name="leaderboardTiming"][value="${data.showLeaderboardAfterEachQuestion === false ? 'end' : 'each'}"]`).checked = true;
    el('questionsList').innerHTML = '';
    if (data.questions && data.questions.length) {
      data.questions.forEach((q) => addQuestionCard(q));
    } else {
      addQuestionCard();
    }
  });

  socket.on('admin:error', (e) => {
    if (e.code === 'bad_pin') {
      el('pinError').textContent = e.message;
      el('pinBox').style.display = 'flex';
      el('controls').style.display = 'none';
      localStorage.removeItem('ql_admin_pin');
      pin = '';
    } else {
      alert(e.message);
    }
  });

  // ---------- Stato ----------
  function renderStatus() {
    if (!state) return;
    const labels = { lobby: 'In attesa', question: 'Domanda attiva', reveal: 'Risultato mostrato', leaderboard: 'Classifica', finished: 'Finito' };
    el('stStatus').textContent = labels[state.status] || state.status;
    el('stQuestion').textContent = state.questionCount ? `${state.currentIndex + 1}/${state.questionCount}` : '—';
    el('stPlayers').textContent = (state.players || []).length;
    el('stAnswers').textContent = state.status === 'question' ? `${state.answersCount || 0}` : '—';
    updateLeaderboardButtonState();
  }

  // Se l'impostazione del quiz dice "solo alla fine", il pulsante manuale resta disattivato
  // finché la partita non è terminata, per non rovinare la sorpresa tra una domanda e l'altra.
  function updateLeaderboardButtonState() {
    const btn = el('btnLeaderboard');
    const showEachQuestion = !state || state.showLeaderboardAfterEachQuestion !== false;
    const allowed = showEachQuestion || state.status === 'finished';
    btn.disabled = !allowed;
    btn.title = allowed ? '' : 'Impostazione quiz: classifica visibile solo a fine partita';
  }

  socket.on('init', (st) => {
    state = {
      status: st.status, quizTitle: st.quizTitle, questionCount: st.questionCount,
      currentIndex: st.currentIndex, players: st.players || [],
      showLeaderboardAfterEachQuestion: st.showLeaderboardAfterEachQuestion,
    };
    if (st.quizTitle) el('quizTitleInput').value = st.quizTitle;
    if (st.showLeaderboardAfterEachQuestion === false) {
      document.querySelector('input[name="leaderboardTiming"][value="end"]').checked = true;
    }
    renderStatus();
  });
  socket.on('players:update', (p) => { if (state) { state.players = p.players; renderStatus(); } });
  socket.on('question:start', () => { if (state) { state.status = 'question'; state.answersCount = 0; renderStatus(); } });
  socket.on('answers:count', (p) => { if (state) { state.answersCount = p.count; renderStatus(); } });
  socket.on('question:reveal', () => { if (state) { state.status = 'reveal'; renderStatus(); } });
  socket.on('leaderboard:show', () => { if (state) { state.status = 'leaderboard'; renderStatus(); } });
  socket.on('game:finished', () => { if (state) { state.status = 'finished'; renderStatus(); } });
  socket.on('reset', () => socket.emit('request-state'));

  // ---------- Controllo partita ----------
  el('btnNextQuestion').addEventListener('click', () => sendAdmin('start-question', {}));
  el('btnReveal').addEventListener('click', () => sendAdmin('reveal'));
  el('btnLeaderboard').addEventListener('click', () => sendAdmin('show-leaderboard'));
  el('btnEndGame').addEventListener('click', () => {
    if (confirm('Terminare la partita e mostrare la classifica finale?')) sendAdmin('end-game');
  });
  el('btnReset').addEventListener('click', () => {
    if (confirm('Reset completo: tutti i giocatori e i punteggi verranno cancellati. Confermi?')) sendAdmin('reset');
  });

  // ---------- Costruttore domande ----------
  function addQuestionCard(data) {
    const id = ++questionSeq;
    const card = document.createElement('div');
    card.className = 'question-card';
    card.dataset.qid = id;
    const d = data || { text: '', type: 'mc', options: ['', ''], correctIndex: 0, timeLimitSec: 20 };
    card.innerHTML = `
      <div class="qhead">
        <strong>Domanda</strong>
        <button class="btn-secondary" data-action="remove">Rimuovi</button>
      </div>
      <label>Testo della domanda</label>
      <input type="text" class="q-text" placeholder="Es. Qual è la capitale della Francia?" maxlength="200" value="${escapeAttr(d.text)}" />
      <div class="type-toggle">
        <label><input type="radio" name="type-${id}" value="mc" ${d.type === 'mc' ? 'checked' : ''} /> Scelta singola</label>
        <label><input type="radio" name="type-${id}" value="multi" ${d.type === 'multi' ? 'checked' : ''} /> Selezione multipla</label>
        <label><input type="radio" name="type-${id}" value="tf" ${d.type === 'tf' ? 'checked' : ''} /> Vero / Falso</label>
      </div>
      <div class="type-hint" data-role="type-hint"></div>
      <div class="options-box" data-role="options"></div>
      <button class="btn-secondary" data-action="add-option" style="display:none;">+ Opzione</button>
      <label>Tempo per rispondere (secondi)</label>
      <input type="number" class="q-time" min="5" max="120" value="${d.timeLimitSec || 20}" />
    `;
    el('questionsList').appendChild(card);

    card.querySelector('[data-action="remove"]').addEventListener('click', () => card.remove());
    card.querySelectorAll(`input[name="type-${id}"]`).forEach((r) => r.addEventListener('change', () => renderOptions(card, id)));
    card.querySelector('[data-action="add-option"]').addEventListener('click', () => {
      const opts = getOptionValues(card);
      if (opts.length < 4) { opts.push(''); renderOptions(card, id, opts); }
    });

    const presetCorrect = d.type === 'multi' ? (d.correctIndexes || [0]) : [d.correctIndex ?? 0];
    renderOptions(card, id, d.type === 'tf' ? null : d.options, presetCorrect);
  }

  function getOptionValues(card) {
    return Array.from(card.querySelectorAll('.opt-text')).map((i) => i.value);
  }

  function renderOptions(card, id, presetOptions, presetCorrectArr) {
    const type = card.querySelector(`input[name="type-${id}"]:checked`).value;
    const box = card.querySelector('[data-role="options"]');
    const addBtn = card.querySelector('[data-action="add-option"]');
    const hint = card.querySelector('[data-role="type-hint"]');
    const correctArr = Array.isArray(presetCorrectArr) ? presetCorrectArr : [presetCorrectArr || 0];
    box.innerHTML = '';
    hint.textContent = type === 'multi' ? 'Segna con la spunta tutte le risposte corrette (2 o più).' : '';
    if (type === 'tf') {
      addBtn.style.display = 'none';
      ['Vero', 'Falso'].forEach((label, i) => {
        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = `<input type="radio" name="correct-${id}" value="${i}" ${correctArr.includes(i) ? 'checked' : ''} /><span>${label}</span>`;
        box.appendChild(row);
      });
      return;
    }
    addBtn.style.display = 'block';
    const inputType = type === 'multi' ? 'checkbox' : 'radio';
    const opts = presetOptions && presetOptions.length ? presetOptions : ['', ''];
    opts.forEach((val, i) => {
      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <input type="${inputType}" name="correct-${id}" value="${i}" ${correctArr.includes(i) ? 'checked' : ''} />
        <input type="text" class="opt-text" placeholder="Opzione ${i + 1}" maxlength="80" value="${escapeAttr(val)}" style="flex:1;" />
        ${i >= 2 ? '<button class="btn-secondary" data-action="remove-option" style="width:auto; padding:6px 10px;">✕</button>' : ''}
      `;
      box.appendChild(row);
      const removeBtn = row.querySelector('[data-action="remove-option"]');
      if (removeBtn) removeBtn.addEventListener('click', () => {
        const vals = getOptionValues(card);
        vals.splice(i, 1);
        renderOptions(card, id, vals);
      });
    });
  }

  function escapeAttr(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  el('btnAddQuestion').addEventListener('click', () => addQuestionCard());

  el('btnSaveQuiz').addEventListener('click', () => {
    const title = el('quizTitleInput').value.trim() || 'Quiz';
    const cards = Array.from(document.querySelectorAll('.question-card'));
    if (!cards.length) { el('quizError').textContent = 'Aggiungi almeno una domanda'; return; }
    const questions = [];
    for (const card of cards) {
      const id = card.dataset.qid;
      const text = card.querySelector('.q-text').value.trim();
      const type = card.querySelector(`input[name="type-${id}"]:checked`).value;
      const timeLimitSec = Number(card.querySelector('.q-time').value) || 20;
      if (!text) { el('quizError').textContent = 'Ogni domanda deve avere un testo'; return; }
      let options;
      if (type === 'tf') {
        options = ['Vero', 'Falso'];
      } else {
        options = getOptionValues(card).map((v) => v.trim());
        if (options.filter((o) => o).length < 2) { el('quizError').textContent = 'Ogni domanda deve avere almeno 2 opzioni'; return; }
      }
      if (type === 'multi') {
        const correctIndexes = Array.from(card.querySelectorAll(`input[name="correct-${id}"]:checked`)).map((i) => Number(i.value));
        if (!correctIndexes.length) { el('quizError').textContent = 'Segna almeno una risposta corretta in ogni domanda a selezione multipla'; return; }
        questions.push({ text, type, options, correctIndexes, timeLimitSec });
      } else {
        const correctRadio = card.querySelector(`input[name="correct-${id}"]:checked`);
        const correctIndex = correctRadio ? Number(correctRadio.value) : 0;
        questions.push({ text, type, options, correctIndex, timeLimitSec });
      }
    }
    el('quizError').textContent = '';
    const showLeaderboardAfterEachQuestion = document.querySelector('input[name="leaderboardTiming"]:checked').value === 'each';
    sendAdmin('set-quiz', { title, questions, showLeaderboardAfterEachQuestion });
    alert(`Quiz salvato con ${questions.length} domande.`);
  });

  // ---------- Export CSV ----------
  el('btnExport').addEventListener('click', () => sendAdmin('export-data'));

  socket.on('admin:export-data', (data) => {
    const rows = [];
    rows.push(['Nickname', 'Punteggio totale', ...data.questions.map((q, i) => `D${i + 1}: ${q.text}`)]);
    data.players
      .sort((a, b) => b.score - a.score)
      .forEach((p) => {
        const row = [p.nickname, p.score];
        data.questions.forEach((q, i) => {
          const h = p.history.find((x) => x.questionIndex === i);
          if (!h) row.push('Non risposto');
          else row.push(`${h.correct ? 'Corretto' : 'Sbagliato'} (${h.points} pt)`);
        });
        rows.push(row);
      });
    const csv = rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = (data.quizTitle || 'quiz').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    a.href = url;
    a.download = `${safeTitle}-risultati.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
})();
