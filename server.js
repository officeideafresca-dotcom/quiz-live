const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3100;
const ADMIN_PIN = process.env.ADMIN_PIN || '2525';
const MAX_PLAYERS = 300;
const MAX_QUESTIONS = 50;
const DEFAULT_TIME_LIMIT = 20;
const BASE_POINTS = 1000;

// Quiz pre-caricato per la serata del 25° anniversario con il team guida: priorità e
// previsioni per il prossimo anno e per i prossimi 3 anni, più un blocco finale su
// emozione e mindset. Le opzioni segnate come "corretta" per le domande di opinione sono
// solo un punto di partenza: modificale dal pannello admin in base alla tua reale strategia
// prima dell'evento (vale soprattutto per le domande 5, 8, 11, 12 dove conta il dato vero).
const DEFAULT_QUIZ = {
  title: 'Idea Fresca — Il futuro del team',
  questions: [
    { text: 'Qual è secondo te la priorità numero uno del team per il prossimo anno?', type: 'mc', options: ['Acquisire nuovi clienti', 'Formare nuovi partner', 'Rafforzare la squadra attuale', 'Investire in strumenti digitali'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Quale canale pensi crescerà di più nei prossimi 12 mesi?', type: 'mc', options: ['Eventi dal vivo', 'Social media', 'Passaparola', 'Formazione online'], correctIndex: 0, timeLimitSec: 20 },
    { text: "Userò l'AI attivamente nel mio lavoro quotidiano entro il prossimo anno", type: 'tf', options: ['Vero', 'Falso'], correctIndex: 0, timeLimitSec: 15 },
    { text: 'Quale skill vorresti sviluppare di più nei prossimi 12 mesi?', type: 'mc', options: ['Vendita e comunicazione', 'Leadership', 'Digitale e AI', 'Gestione del tempo'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Quanti eventi di squadra/locali ti aspetti nel prossimo anno?', type: 'mc', options: ['1-5', '6-10', '11-20', 'Più di 20'], correctIndex: 1, timeLimitSec: 20 },
    { text: 'Il prossimo anno parteciperò ad almeno un evento in più rispetto a quest\'anno', type: 'tf', options: ['Vero', 'Falso'], correctIndex: 0, timeLimitSec: 15 },
    { text: 'Tra 3 anni, come vedi la tua posizione nel team?', type: 'mc', options: ['Come oggi ma più solida', 'Leader di una nuova squadra', 'Specializzato in un\'area chiave', 'Non ci ho ancora pensato'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Qual è il più grande ostacolo alla crescita nei prossimi 3 anni secondo te?', type: 'mc', options: ['Concorrenza', 'Reclutamento difficile', 'Poco tempo per la formazione', 'Cambiamenti del mercato'], correctIndex: 1, timeLimitSec: 20 },
    { text: "Tra 3 anni l'AI sarà uno strumento quotidiano per la maggior parte del team", type: 'tf', options: ['Vero', 'Falso'], correctIndex: 0, timeLimitSec: 15 },
    { text: 'Che tipo di eventi vorresti di più nei prossimi 3 anni?', type: 'mc', options: ['Grandi eventi nazionali', 'Eventi locali frequenti', 'Eventi online/ibridi', 'Viaggi incentive'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Qual è, secondo te, il traguardo più importante per i 28 anni di Idea Fresca?', type: 'mc', options: ['Più partner nella rete', 'Più fatturato', 'Più riconoscibilità del brand', 'Più impatto nella formazione'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Tra 3 anni la formazione sarà soprattutto digitale, non più in presenza', type: 'tf', options: ['Vero', 'Falso'], correctIndex: 1, timeLimitSec: 15 },
    { text: 'Cosa ti rende più orgoglioso di far parte di Idea Fresca oggi?', type: 'mc', options: ['Le relazioni costruite', 'La libertà che mi dà questo lavoro', 'La crescita personale che ho fatto', 'L\'impatto che ho sulla vita degli altri'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'Nei momenti difficili, quello che mi fa continuare è più legato alle persone del team che ai risultati numerici', type: 'tf', options: ['Vero', 'Falso'], correctIndex: 0, timeLimitSec: 15 },
    { text: 'Qual è il mindset che vuoi portare con te nei prossimi 25 anni?', type: 'mc', options: ['Coraggio di osare', 'Costanza nel tempo', 'Apertura al cambiamento', 'Gratitudine per il percorso fatto'], correctIndex: 0, timeLimitSec: 20 },
    { text: 'In una parola, cosa rappresentano per te questi 25 anni?', type: 'mc', options: ['Famiglia', 'Crescita', 'Sfida', 'Eredità'], correctIndex: 0, timeLimitSec: 20 },
  ],
};

function freshState() {
  return {
    status: 'lobby', // lobby | question | reveal | leaderboard | finished
    quizTitle: DEFAULT_QUIZ.title,
    questions: DEFAULT_QUIZ.questions.map((q) => ({ ...q, options: [...q.options] })), // { text, type:'mc'|'tf', options:[...], correctIndex, timeLimitSec }
    showLeaderboardAfterEachQuestion: true, // impostazione del quiz: classifica dopo ogni domanda o solo alla fine
    currentIndex: -1,
    currentStartedAt: null,
    currentAnswersCount: 0,
    players: {}, // playerId -> { id, nickname, score, answered: {questionIndex: true}, history: [...] }
  };
}

let state = freshState();

function publicPlayerList() {
  return Object.values(state.players)
    .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function currentQuestion() {
  return state.questions[state.currentIndex] || null;
}

function publicQuestionForScreen(q) {
  if (!q) return null;
  return { text: q.text, type: q.type, options: q.options, timeLimitSec: q.timeLimitSec, index: state.currentIndex, total: state.questions.length };
}

function publicQuestionForPlayer(q) {
  if (!q) return null;
  // ai partecipanti non mandiamo il testo della domanda: stile Kahoot, guardano il maxischermo
  return { type: q.type, optionCount: q.options.length, timeLimitSec: q.timeLimitSec, index: state.currentIndex };
}

function computeScore(correct, elapsedMs, timeLimitSec) {
  if (!correct) return 0;
  const timeLimitMs = timeLimitSec * 1000;
  const ratio = Math.min(1, Math.max(0, elapsedMs / timeLimitMs));
  return Math.round(BASE_POINTS * (1 - ratio * 0.5));
}

function sanitizeQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_QUESTIONS).map((q) => {
    const type = q.type === 'tf' ? 'tf' : (q.type === 'multi' ? 'multi' : 'mc');
    let options = type === 'tf' ? ['Vero', 'Falso'] : (Array.isArray(q.options) ? q.options.map((o) => String(o || '').slice(0, 80)).slice(0, 4) : []);
    options = options.filter((o) => o.length > 0);
    if (type !== 'tf' && options.length < 2) return null;
    const timeLimitSec = Math.min(120, Math.max(5, Number(q.timeLimitSec) || DEFAULT_TIME_LIMIT));
    const text = String(q.text || '').slice(0, 200).trim();
    if (!text) return null;
    if (type === 'multi') {
      let correctIndexes = Array.isArray(q.correctIndexes)
        ? [...new Set(q.correctIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < options.length))]
        : [];
      if (!correctIndexes.length) correctIndexes = [0];
      return { text, type, options, correctIndexes, timeLimitSec };
    }
    let correctIndex = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
    if (correctIndex < 0 || correctIndex >= options.length) correctIndex = 0;
    return { text, type, options, correctIndex, timeLimitSec };
  }).filter(Boolean);
}

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function buildPublicUrl(req) {
  const hostHeader = req.get('host') || `localhost:${PORT}`;
  const hostname = hostHeader.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const ips = getLocalIPs();
    return `http://${ips[0] || 'localhost'}:${PORT}/`;
  }
  const protocol = req.protocol || 'http';
  return `${protocol}://${hostHeader}/`;
}

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2 * 1024 * 1024 });

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self' ws: wss:; " +
      "base-uri 'self'; object-src 'none'; frame-ancestors 'self';"
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/state', (req, res) => {
  res.json({
    status: state.status,
    quizTitle: state.quizTitle,
    questionCount: state.questions.length,
    currentIndex: state.currentIndex,
    playerCount: Object.keys(state.players).length,
  });
});

app.get('/api/qr', async (req, res) => {
  const url = req.query.host ? `http://${req.query.host}:${PORT}/` : buildPublicUrl(req);
  try {
    const buf = await QRCode.toBuffer(url, { width: 480, margin: 1, color: { dark: '#2b2170', light: '#FFFFFF' } });
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'qr_failed' });
  }
});

app.get('/api/results', (req, res) => {
  // Endpoint usato dal server di Idea Fresca 25 Anni per leggere in automatico il
  // riepilogo del quiz (collegamento tecnico tra le due app). Protetto dal PIN admin
  // di questa app, passato come query string: non va mai chiamato da una pagina pubblica.
  if (String(req.query.pin || '') !== ADMIN_PIN) {
    res.status(401).json({ error: 'bad_pin' });
    return;
  }
  const players = Object.values(state.players)
    .map((p) => ({ nickname: p.nickname, score: p.score, history: p.history }))
    .sort((a, b) => b.score - a.score);
  const questions = state.questions.map((q) => ({ text: q.text, options: q.options, correctIndex: q.correctIndex, correctIndexes: q.correctIndexes }));
  res.json({
    quizTitle: state.quizTitle,
    status: state.status,
    playerCount: players.length,
    questions,
    players,
  });
});

function initPayload() {
  return {
    status: state.status,
    quizTitle: state.quizTitle,
    questionCount: state.questions.length,
    showLeaderboardAfterEachQuestion: state.showLeaderboardAfterEachQuestion,
    currentIndex: state.currentIndex,
    players: publicPlayerList(),
    question: state.status === 'question' ? publicQuestionForScreen(currentQuestion()) : null,
  };
}

io.on('connection', (socket) => {
  socket.emit('init', initPayload());

  socket.on('request-state', () => socket.emit('init', initPayload()));

  socket.on('join-game', ({ nickname, playerId }) => {
    const clean = String(nickname || '').trim().slice(0, 24);
    if (!clean) { socket.emit('join:error', { message: 'Scrivi un nome prima di entrare' }); return; }
    if (Object.keys(state.players).length >= MAX_PLAYERS && !(playerId && state.players[playerId])) {
      socket.emit('join:error', { message: 'Partita piena' });
      return;
    }
    const id = playerId && state.players[playerId] ? playerId : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!state.players[id]) {
      state.players[id] = { id, nickname: clean, score: 0, answered: {}, history: [] };
    } else {
      state.players[id].nickname = clean;
    }
    socket.data.playerId = id;
    socket.emit('join:ok', { playerId: id });
    io.emit('players:update', { players: publicPlayerList() });
  });

  socket.on('submit-answer', ({ playerId, questionIndex, optionIndex, optionIndexes }) => {
    if (state.status !== 'question' || questionIndex !== state.currentIndex) return;
    const player = state.players[playerId];
    const q = currentQuestion();
    if (!player || !q) return;
    if (player.answered[questionIndex] != null) return; // già risposto
    const elapsedMs = Date.now() - (state.currentStartedAt || Date.now());
    let correct, points, chosenIndexes;
    if (q.type === 'multi') {
      // Selezione multipla: il telefono invia la risposta solo allo scadere del tempo (nessun
      // bonus di velocità), corretta solo se l'insieme scelto coincide esattamente con quello giusto.
      chosenIndexes = Array.isArray(optionIndexes)
        ? [...new Set(optionIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length))]
        : [];
      const correctSet = new Set(q.correctIndexes);
      correct = chosenIndexes.length === correctSet.size && chosenIndexes.every((i) => correctSet.has(i));
      points = correct ? BASE_POINTS : 0;
    } else {
      chosenIndexes = null;
      correct = optionIndex === q.correctIndex;
      points = computeScore(correct, elapsedMs, q.timeLimitSec);
    }
    player.answered[questionIndex] = true;
    player.score += points;
    player.history.push({ questionIndex, optionIndex: q.type === 'multi' ? null : optionIndex, optionIndexes: chosenIndexes, correct, points, elapsedMs });
    state.currentAnswersCount++;
    socket.emit('answer:ack', { correct: null, locked: true }); // conferma "ricevuta", non svela se è giusta
    io.emit('answers:count', { count: state.currentAnswersCount, total: Object.keys(state.players).length });
  });

  socket.on('admin', ({ pin, action, payload }) => {
    if (pin !== ADMIN_PIN) {
      socket.emit('admin:error', { message: 'PIN errato', code: 'bad_pin' });
      return;
    }
    switch (action) {
      case 'set-quiz': {
        state.quizTitle = String((payload && payload.title) || 'Quiz').slice(0, 80);
        state.questions = sanitizeQuestions(payload && payload.questions);
        state.showLeaderboardAfterEachQuestion = !(payload && payload.showLeaderboardAfterEachQuestion === false);
        state.currentIndex = -1;
        state.status = 'lobby';
        io.emit('init', initPayload());
        return;
      }
      case 'start-question': {
        if (!state.questions.length) return;
        state.currentIndex = (payload && Number.isInteger(payload.index)) ? payload.index : state.currentIndex + 1;
        if (state.currentIndex < 0 || state.currentIndex >= state.questions.length) return;
        state.status = 'question';
        state.currentStartedAt = Date.now();
        state.currentAnswersCount = 0;
        const q = currentQuestion();
        io.emit('question:start', {
          screen: publicQuestionForScreen(q),
          player: publicQuestionForPlayer(q),
          startedAt: state.currentStartedAt,
        });
        return;
      }
      case 'reveal': {
        if (state.status !== 'question') return;
        state.status = 'reveal';
        const q = currentQuestion();
        const counts = new Array(q.options.length).fill(0);
        let noAnswer = 0;
        Object.values(state.players).forEach((p) => {
          const entry = p.history.find((h) => h.questionIndex === state.currentIndex);
          if (!entry) { noAnswer++; return; }
          if (q.type === 'multi') {
            (entry.optionIndexes || []).forEach((i) => { counts[i] = (counts[i] || 0) + 1; });
          } else {
            counts[entry.optionIndex] = (counts[entry.optionIndex] || 0) + 1;
          }
        });
        io.emit('question:reveal', {
          correctIndex: q.type === 'multi' ? null : q.correctIndex,
          correctIndexes: q.type === 'multi' ? q.correctIndexes : null,
          options: q.options,
          counts,
          noAnswer,
          players: publicPlayerList(),
        });
        return;
      }
      case 'show-leaderboard': {
        state.status = 'leaderboard';
        io.emit('leaderboard:show', { players: publicPlayerList().slice(0, 10) });
        return;
      }
      case 'end-game': {
        state.status = 'finished';
        io.emit('game:finished', { players: publicPlayerList() });
        return;
      }
      case 'reset': {
        state = freshState();
        io.emit('reset');
        return;
      }
      case 'get-quiz': {
        // Solo a chi la richiede (il pannello admin): include le risposte corrette,
        // quindi non va mai mandato in broadcast a schermo/partecipanti.
        socket.emit('admin:quiz-data', {
          title: state.quizTitle,
          questions: state.questions,
          showLeaderboardAfterEachQuestion: state.showLeaderboardAfterEachQuestion,
        });
        return;
      }
      case 'export-data': {
        // Solo a chi la richiede (il pannello admin): dettaglio completo per il CSV.
        const players = Object.values(state.players).map((p) => ({
          nickname: p.nickname,
          score: p.score,
          history: p.history,
        }));
        const questions = state.questions.map((q) => ({ text: q.text, options: q.options, correctIndex: q.correctIndex, correctIndexes: q.correctIndexes }));
        socket.emit('admin:export-data', { quizTitle: state.quizTitle, questions, players });
        return;
      }
      default:
        return;
    }
  });

  socket.on('disconnect', () => {
    // i giocatori restano in classifica anche se il telefono si disconnette un attimo
  });
});

server.listen(PORT, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://${getLocalIPs()[0] || 'localhost'}:${PORT}`;
  console.log(`Quiz Live - server avviato sulla porta ${PORT}`);
  console.log(`Partecipanti (QR): ${base}/`);
  console.log(`Schermo grande:    ${base}/screen`);
  console.log(`Pannello regia:    ${base}/admin`);
  console.log(`PIN Admin: ${ADMIN_PIN}`);
});
