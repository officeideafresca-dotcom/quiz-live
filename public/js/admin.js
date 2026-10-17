(function () {
  const el = (id) => document.getElementById(id);
  const socket = io();
  const QUIZ_LANGS = ['it', 'de', 'fr', 'es', 'en'];
  const LANG_LABELS = { it: 'IT', de: 'DE', fr: 'FR', es: 'ES', en: 'EN' };
  const TF_LABELS = {
    it: ['Vero', 'Falso'], de: ['Wahr', 'Falsch'], fr: ['Vrai', 'Faux'], es: ['Verdadero', 'Falso'], en: ['True', 'False'],
  };

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
    clearDirty(); // appena ricaricato dal server: non c'è ancora nessuna modifica locale
  });

  // ---------- Barra "modifiche non salvate" ----------
  // Il bottone "Salva quiz" in fondo alla lista è facile da perdere di vista quando ci sono
  // tante domande: questa barra fissa in basso compare appena si tocca qualcosa nell'editor,
  // così si sa sempre che bisogna salvare e il bottone resta a portata di mano.
  function markDirty() { el('saveBar').style.display = 'flex'; }
  function clearDirty() { el('saveBar').style.display = 'none'; }

  el('quizTitleInput').addEventListener('input', markDirty);
  document.querySelectorAll('input[name="leaderboardTiming"]').forEach((r) => r.addEventListener('change', markDirty));
  el('questionsList').addEventListener('input', markDirty);
  el('questionsList').addEventListener('change', markDirty);
  el('questionsList').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="remove"], [data-action="add-option"], [data-action="remove-option"]')) markDirty();
  });
  el('btnAddQuestion').addEventListener('click', markDirty);
  el('btnSaveQuizFloating').addEventListener('click', () => el('btnSaveQuiz').click());

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
    if (st.screenLang) el('screenLangSelect').value = st.screenLang;
    renderStatus();
  });
  socket.on('players:update', (p) => { if (state) { state.players = p.players; renderStatus(); } });
  socket.on('question:start', () => { if (state) { state.status = 'question'; state.answersCount = 0; renderStatus(); } });
  socket.on('answers:count', (p) => { if (state) { state.answersCount = p.count; renderStatus(); } });
  socket.on('question:reveal', () => { if (state) { state.status = 'reveal'; renderStatus(); } });
  socket.on('leaderboard:show', () => { if (state) { state.status = 'leaderboard'; renderStatus(); } });
  socket.on('game:finished', () => { if (state) { state.status = 'finished'; renderStatus(); } });
  socket.on('reset', () => socket.emit('request-state'));

  // ---------- Lingua maxischermo ----------
  el('screenLangSelect').addEventListener('change', () => {
    sendAdmin('set-screen-lang', { lang: el('screenLangSelect').value });
  });

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

  // ---------- Costruttore domande (editor multilingua: IT/DE/FR/ES/EN) ----------
  // Ogni card tiene in memoria il testo e le opzioni di TUTTE le lingue (card._translations);
  // in un dato momento i campi mostrano solo la lingua attiva (card._activeLang), selezionabile
  // con le linguette in alto. Tipo di domanda e risposta corretta sono invece condivisi tra le
  // lingue (riguardano l'indice dell'opzione, non il suo testo).
  function addQuestionCard(data) {
    const id = ++questionSeq;
    const card = document.createElement('div');
    card.className = 'question-card';
    card.dataset.qid = id;
    const d = data || { type: 'mc', correctIndex: 0, timeLimitSec: 20, translations: {} };

    card._translations = {};
    QUIZ_LANGS.forEach((l) => {
      const t = (d.translations && d.translations[l]) || {};
      card._translations[l] = {
        text: t.text || '',
        options: Array.isArray(t.options) && t.options.length ? t.options.slice() : ['', ''],
      };
    });
    card._activeLang = 'it';
    card._lastCorrect = d.type === 'multi' ? (d.correctIndexes || [0]) : [d.correctIndex ?? 0];

    card.innerHTML = `
      <div class="qhead">
        <strong>Domanda</strong>
        <button class="btn-secondary" data-action="remove">Rimuovi</button>
      </div>
      <div class="lang-tabs" data-role="lang-tabs"></div>
      <label>Testo della domanda</label>
      <input type="text" class="q-text" placeholder="Es. Qual è la capitale della Francia?" maxlength="200" />
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

    renderLangTabs(card, id);
    loadActiveLangIntoFields(card);

    card.querySelector('[data-action="remove"]').addEventListener('click', () => card.remove());
    card.querySelector('.q-text').addEventListener('input', (e) => {
      card._translations[card._activeLang].text = e.target.value;
    });
    card.querySelectorAll(`input[name="type-${id}"]`).forEach((r) => r.addEventListener('change', () => {
      syncCorrectFromDom(card, id);
      renderOptions(card, id);
    }));
    card.querySelector('[data-action="add-option"]').addEventListener('click', () => {
      if (card._translations.it.options.length < 4) {
        syncCorrectFromDom(card, id);
        QUIZ_LANGS.forEach((l) => card._translations[l].options.push(''));
        renderOptions(card, id);
      }
    });

    renderOptions(card, id);
  }

  // Legge quali caselle/pallini "risposta corretta" sono spuntati ADESSO nel DOM e li
  // salva in card._lastCorrect, PRIMA di ricostruire la lista opzioni (cambio linguetta di
  // lingua, aggiunta/rimozione opzione): senza questo passaggio, ogni volta che si ridisegna
  // la lista si perderebbero le spunte appena messe dall'admin, tornando all'ultimo stato noto.
  function syncCorrectFromDom(card, id) {
    const checked = Array.from(card.querySelectorAll(`input[name="correct-${id}"]:checked`)).map((i) => Number(i.value));
    if (checked.length) card._lastCorrect = checked;
  }

  function renderLangTabs(card, id) {
    const box = card.querySelector('[data-role="lang-tabs"]');
    box.innerHTML = '';
    QUIZ_LANGS.forEach((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-tab' + (l === card._activeLang ? ' active' : '');
      b.textContent = LANG_LABELS[l];
      b.addEventListener('click', () => {
        syncCorrectFromDom(card, id);
        card._activeLang = l;
        renderLangTabs(card, id);
        loadActiveLangIntoFields(card);
        renderOptions(card, id);
      });
      box.appendChild(b);
    });
  }

  function loadActiveLangIntoFields(card) {
    card.querySelector('.q-text').value = card._translations[card._activeLang].text;
  }

  function renderOptions(card, id) {
    const type = card.querySelector(`input[name="type-${id}"]:checked`).value;
    const box = card.querySelector('[data-role="options"]');
    const addBtn = card.querySelector('[data-action="add-option"]');
    const hint = card.querySelector('[data-role="type-hint"]');
    const correctArr = card._lastCorrect && card._lastCorrect.length ? card._lastCorrect : [0];
    box.innerHTML = '';
    hint.textContent = type === 'multi' ? 'Segna con la spunta tutte le risposte corrette (2 o più).' : '';
    // Rete di sicurezza: ogni volta che l'admin spunta/togli una risposta corretta, lo
    // registriamo subito in card._lastCorrect (oltre a syncCorrectFromDom chiamato prima di
    // ogni ridisegno), così non si perde mai anche se in futuro si aggiunge un altro punto
    // che ricostruisce la lista delle opzioni.
    box.addEventListener('change', (e) => {
      if (e.target.matches(`input[name="correct-${id}"]`)) syncCorrectFromDom(card, id);
    });

    if (type === 'tf') {
      addBtn.style.display = 'none';
      const labels = TF_LABELS[card._activeLang] || TF_LABELS.it;
      labels.forEach((label, i) => {
        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = `<input type="radio" name="correct-${id}" value="${i}" ${correctArr.includes(i) ? 'checked' : ''} /><span>${label}</span>`;
        box.appendChild(row);
      });
      return;
    }

    addBtn.style.display = 'block';
    const inputType = type === 'multi' ? 'checkbox' : 'radio';
    const opts = card._translations[card._activeLang].options;
    opts.forEach((val, i) => {
      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <input type="${inputType}" name="correct-${id}" value="${i}" ${correctArr.includes(i) ? 'checked' : ''} />
        <input type="text" class="opt-text" data-idx="${i}" placeholder="Opzione ${i + 1}" maxlength="80" value="${escapeAttr(val)}" style="flex:1;" />
        ${i >= 2 ? '<button class="btn-secondary" data-action="remove-option" style="width:auto; padding:6px 10px;">✕</button>' : ''}
      `;
      box.appendChild(row);
      row.querySelector('.opt-text').addEventListener('input', (e) => {
        card._translations[card._activeLang].options[i] = e.target.value;
      });
      const removeBtn = row.querySelector('[data-action="remove-option"]');
      if (removeBtn) removeBtn.addEventListener('click', () => {
        syncCorrectFromDom(card, id);
        QUIZ_LANGS.forEach((l) => card._translations[l].options.splice(i, 1));
        card._lastCorrect = card._lastCorrect.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
        renderOptions(card, id);
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
    if (!cards.length) { showSaveError('Aggiungi almeno una domanda'); return; }
    const questions = [];
    for (let idx = 0; idx < cards.length; idx++) {
      const card = cards[idx];
      const id = card.dataset.qid;
      const type = card.querySelector(`input[name="type-${id}"]:checked`).value;
      const timeLimitSec = Number(card.querySelector('.q-time').value) || 20;
      const itText = card._translations.it.text.trim();
      if (!itText) { showSaveError(`Domanda ${idx + 1}: scrivi almeno il testo in italiano (le altre lingue sono opzionali)`); return; }

      let translations;
      if (type === 'tf') {
        translations = {};
        QUIZ_LANGS.forEach((l) => { translations[l] = { text: card._translations[l].text.trim(), options: TF_LABELS[l] }; });
      } else {
        const itOpts = card._translations.it.options.map((v) => v.trim());
        if (itOpts.filter((o) => o).length < 2) { showSaveError(`Domanda ${idx + 1}: servono almeno 2 opzioni in italiano`); return; }
        translations = {};
        QUIZ_LANGS.forEach((l) => { translations[l] = { text: card._translations[l].text.trim(), options: card._translations[l].options.map((v) => v.trim()) }; });
      }

      if (type === 'multi') {
        const correctIndexes = Array.from(card.querySelectorAll(`input[name="correct-${id}"]:checked`)).map((i) => Number(i.value));
        if (!correctIndexes.length) { showSaveError(`Domanda ${idx + 1}: segna almeno una risposta corretta`); return; }
        questions.push({ type, translations, correctIndexes, timeLimitSec });
      } else {
        const correctRadio = card.querySelector(`input[name="correct-${id}"]:checked`);
        const correctIndex = correctRadio ? Number(correctRadio.value) : 0;
        questions.push({ type, translations, correctIndex, timeLimitSec });
      }
    }
    el('quizError').textContent = '';
    const showLeaderboardAfterEachQuestion = document.querySelector('input[name="leaderboardTiming"]:checked').value === 'each';
    sendAdmin('set-quiz', { title, questions, showLeaderboardAfterEachQuestion });
    clearDirty();
    alert(`Quiz salvato con ${questions.length} domande.`);
  });

  // Il salvataggio di TUTTE le domande fallisce se anche una sola non è valida: un alert
  // (impossibile non vedere, a differenza del testo in fondo alla pagina) dice subito quale.
  function showSaveError(msg) {
    el('quizError').textContent = msg;
    alert('Impossibile salvare: ' + msg);
  }

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
