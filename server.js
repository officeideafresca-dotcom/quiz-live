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

function freshState() {
  return {
    status: 'lobby', // lobby | question | reveal | leaderboard | finished
    quizTitle: 'Quiz',
    questions: [], // { text, type:'mc'|'tf', options:[...], correctIndex, timeLimitSec }
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
    const type = q.type === 'tf' ? 'tf' : 'mc';
    let options = type === 'tf' ? ['Vero', 'Falso'] : (Array.isArray(q.options) ? q.options.map((o) => String(o || '').slice(0, 80)).slice(0, 4) : []);
    options = options.filter((o) => o.length > 0);
    if (type === 'mc' && options.length < 2) return null;
    let correctIndex = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
    if (correctIndex < 0 || correctIndex >= options.length) correctIndex = 0;
    const timeLimitSec = Math.min(120, Math.max(5, Number(q.timeLimitSec) || DEFAULT_TIME_LIMIT));
    const text = String(q.text || '').slice(0, 200).trim();
    if (!text) return null;
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

  socket.on('submit-answer', ({ playerId, questionIndex, optionIndex }) => {
    if (state.status !== 'question' || questionIndex !== state.currentIndex) return;
    const player = state.players[playerId];
    const q = currentQuestion();
    if (!player || !q) return;
    if (player.answered[questionIndex] != null) return; // già risposto
    const elapsedMs = Date.now() - (state.currentStartedAt || Date.now());
    const correct = optionIndex === q.correctIndex;
    const points = computeScore(correct, elapsedMs, q.timeLimitSec);
    player.answered[questionIndex] = true;
    player.score += points;
    player.history.push({ questionIndex, optionIndex, correct, points, elapsedMs });
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
          if (entry) counts[entry.optionIndex] = (counts[entry.optionIndex] || 0) + 1;
          else noAnswer++;
        });
        io.emit('question:reveal', {
          correctIndex: q.correctIndex,
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
      case 'export-data': {
        // Solo a chi la richiede (il pannello admin): dettaglio completo per il CSV.
        const players = Object.values(state.players).map((p) => ({
          nickname: p.nickname,
          score: p.score,
          history: p.history,
        }));
        const questions = state.questions.map((q) => ({ text: q.text, options: q.options, correctIndex: q.correctIndex }));
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
