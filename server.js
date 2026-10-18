const express = require('express');
const fs = require('fs');
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

// Il quiz configurato dall'admin (titolo, domande, lingua schermo) viene salvato qui su
// disco ad ogni modifica, così un riavvio del server (crash, risveglio dallo standby) lo
// ritrova invece di tornare alle domande di default. ATTENZIONE: su un deploy vero e proprio
// (nuovo codice pubblicato) molte piattaforme — incluso il piano gratuito di Render — creano
// un disco completamente nuovo e vuoto: in quel caso anche questo file va perso. Per una
// garanzia reale servirebbe un database o un disco persistente (piano a pagamento).
const DATA_DIR = path.join(__dirname, 'data');
const QUIZ_FILE = path.join(DATA_DIR, 'quiz.json');

function loadSavedQuiz() {
  try {
    const raw = fs.readFileSync(QUIZ_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.questions) || !data.questions.length) return null;
    return data;
  } catch (e) {
    return null; // nessun file salvato, o illeggibile: si parte dal quiz di default
  }
}

function saveQuizToDisk() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      title: state.quizTitle,
      questions: state.questions,
      showLeaderboardAfterEachQuestion: state.showLeaderboardAfterEachQuestion,
      screenLang: state.screenLang,
    };
    fs.writeFileSync(QUIZ_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('Impossibile salvare il quiz su disco:', e.message);
  }
}

const QUIZ_LANGS = ['it', 'de', 'fr', 'es', 'en'];
const DEFAULT_SCREEN_LANG = 'en'; // lingua di partenza del maxischermo, cambiabile dal pannello admin
const TF_LABELS = {
  it: ['Vero', 'Falso'],
  de: ['Wahr', 'Falsch'],
  fr: ['Vrai', 'Faux'],
  es: ['Verdadero', 'Falso'],
  en: ['True', 'False'],
};

// Quiz pre-caricato per la serata del 25° anniversario con il team guida: priorità e
// previsioni per il prossimo anno e per i prossimi 3 anni, più un blocco finale su
// emozione e mindset. Le opzioni segnate come "corretta" per le domande di opinione sono
// solo un punto di partenza: modificale dal pannello admin in base alla tua reale strategia
// prima dell'evento (vale soprattutto per le domande 5, 8, 11, 12 dove conta il dato vero).
// Ogni domanda ha testo e opzioni tradotti in IT/DE/FR/ES/EN: il maxischermo mostra sempre
// l'inglese, ogni partecipante vede la sua lingua sullo smartphone.
const DEFAULT_QUIZ = {
  title: {
    it: 'Idea Fresca — Il futuro del team',
    de: 'Idea Fresca — Die Zukunft des Teams',
    fr: "Idea Fresca — L'avenir de l'équipe",
    es: 'Idea Fresca — El futuro del equipo',
    en: 'Idea Fresca — The future of the team',
  },
  questions: [
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Qual è secondo te la priorità numero uno del team per il prossimo anno?', options: ['Acquisire nuovi clienti', 'Formare nuovi partner', 'Rafforzare la squadra attuale', 'Investire in strumenti digitali'] },
        de: { text: 'Was ist deiner Meinung nach die oberste Priorität des Teams für das nächste Jahr?', options: ['Neue Kunden gewinnen', 'Neue Partner ausbilden', 'Das aktuelle Team stärken', 'In digitale Tools investieren'] },
        fr: { text: "Selon toi, quelle est la priorité numéro un de l'équipe pour l'année prochaine ?", options: ['Acquérir de nouveaux clients', 'Former de nouveaux partenaires', "Renforcer l'équipe actuelle", 'Investir dans des outils numériques'] },
        es: { text: '¿Cuál es, en tu opinión, la prioridad número uno del equipo para el próximo año?', options: ['Adquirir nuevos clientes', 'Formar nuevos socios', 'Reforzar el equipo actual', 'Invertir en herramientas digitales'] },
        en: { text: "In your opinion, what is the team's number one priority for next year?", options: ['Acquire new clients', 'Train new partners', 'Strengthen the current team', 'Invest in digital tools'] },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Quale canale pensi crescerà di più nei prossimi 12 mesi?', options: ['Eventi dal vivo', 'Social media', 'Passaparola', 'Formazione online'] },
        de: { text: 'Welcher Kanal wird deiner Meinung nach in den nächsten 12 Monaten am meisten wachsen?', options: ['Live-Events', 'Soziale Medien', 'Mundpropaganda', 'Online-Schulungen'] },
        fr: { text: 'Selon toi, quel canal va le plus croître au cours des 12 prochains mois ?', options: ['Événements en direct', 'Réseaux sociaux', 'Bouche-à-oreille', 'Formation en ligne'] },
        es: { text: '¿Qué canal crees que crecerá más en los próximos 12 meses?', options: ['Eventos en vivo', 'Redes sociales', 'Boca a boca', 'Formación online'] },
        en: { text: 'Which channel do you think will grow the most in the next 12 months?', options: ['Live events', 'Social media', 'Word of mouth', 'Online training'] },
      },
    },
    {
      type: 'tf', correctIndex: 0, timeLimitSec: 15,
      translations: {
        it: { text: "Userò l'AI attivamente nel mio lavoro quotidiano entro il prossimo anno", options: TF_LABELS.it },
        de: { text: 'Ich werde KI innerhalb des nächsten Jahres aktiv in meiner täglichen Arbeit einsetzen', options: TF_LABELS.de },
        fr: { text: "J'utiliserai activement l'IA dans mon travail quotidien d'ici l'année prochaine", options: TF_LABELS.fr },
        es: { text: 'Usaré activamente la IA en mi trabajo diario dentro del próximo año', options: TF_LABELS.es },
        en: { text: 'I will actively use AI in my daily work within the next year', options: TF_LABELS.en },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Quale skill vorresti sviluppare di più nei prossimi 12 mesi?', options: ['Vendita e comunicazione', 'Leadership', 'Digitale e AI', 'Gestione del tempo'] },
        de: { text: 'Welche Fähigkeit möchtest du in den nächsten 12 Monaten am meisten entwickeln?', options: ['Verkauf und Kommunikation', 'Führung', 'Digital und KI', 'Zeitmanagement'] },
        fr: { text: 'Quelle compétence aimerais-tu développer le plus au cours des 12 prochains mois ?', options: ['Vente et communication', 'Leadership', 'Numérique et IA', 'Gestion du temps'] },
        es: { text: '¿Qué habilidad te gustaría desarrollar más en los próximos 12 meses?', options: ['Venta y comunicación', 'Liderazgo', 'Digital e IA', 'Gestión del tiempo'] },
        en: { text: 'Which skill would you most like to develop in the next 12 months?', options: ['Sales and communication', 'Leadership', 'Digital and AI', 'Time management'] },
      },
    },
    {
      type: 'mc', correctIndex: 1, timeLimitSec: 20,
      translations: {
        it: { text: 'Quanti eventi di squadra/locali ti aspetti nel prossimo anno?', options: ['1-5', '6-10', '11-20', 'Più di 20'] },
        de: { text: 'Wie viele Team-/lokale Events erwartest du im nächsten Jahr?', options: ['1-5', '6-10', '11-20', 'Mehr als 20'] },
        fr: { text: "Combien d'événements d'équipe/locaux attends-tu l'année prochaine ?", options: ['1-5', '6-10', '11-20', 'Plus de 20'] },
        es: { text: '¿Cuántos eventos de equipo/locales esperas el próximo año?', options: ['1-5', '6-10', '11-20', 'Más de 20'] },
        en: { text: 'How many team/local events do you expect next year?', options: ['1-5', '6-10', '11-20', 'More than 20'] },
      },
    },
    {
      type: 'tf', correctIndex: 0, timeLimitSec: 15,
      translations: {
        it: { text: "Il prossimo anno parteciperò ad almeno un evento in più rispetto a quest'anno", options: TF_LABELS.it },
        de: { text: 'Nächstes Jahr werde ich an mindestens einem Event mehr teilnehmen als dieses Jahr', options: TF_LABELS.de },
        fr: { text: "L'année prochaine, je participerai à au moins un événement de plus que cette année", options: TF_LABELS.fr },
        es: { text: 'El próximo año participaré en al menos un evento más que este año', options: TF_LABELS.es },
        en: { text: 'Next year I will attend at least one more event than this year', options: TF_LABELS.en },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Tra 3 anni, come vedi la tua posizione nel team?', options: ['Come oggi ma più solida', 'Leader di una nuova squadra', "Specializzato in un'area chiave", 'Non ci ho ancora pensato'] },
        de: { text: 'Wie siehst du deine Position im Team in 3 Jahren?', options: ['Wie heute, aber stabiler', 'Leiter eines neuen Teams', 'Spezialisiert auf einen Schlüsselbereich', 'Darüber habe ich noch nicht nachgedacht'] },
        fr: { text: 'Dans 3 ans, comment vois-tu ta position dans l’équipe ?', options: ['Comme aujourd’hui mais plus solide', "Leader d'une nouvelle équipe", 'Spécialisé dans un domaine clé', "Je n'y ai pas encore pensé"] },
        es: { text: '¿Cómo ves tu posición en el equipo dentro de 3 años?', options: ['Como hoy pero más sólida', 'Líder de un nuevo equipo', 'Especializado en un área clave', 'Todavía no lo he pensado'] },
        en: { text: 'In 3 years, how do you see your position in the team?', options: ['Like today but stronger', 'Leader of a new team', 'Specialized in a key area', "I haven't thought about it yet"] },
      },
    },
    {
      type: 'mc', correctIndex: 1, timeLimitSec: 20,
      translations: {
        it: { text: "Qual è il più grande ostacolo alla crescita nei prossimi 3 anni secondo te?", options: ['Concorrenza', 'Reclutamento difficile', 'Poco tempo per la formazione', 'Cambiamenti del mercato'] },
        de: { text: 'Was ist deiner Meinung nach das größte Wachstumshindernis in den nächsten 3 Jahren?', options: ['Konkurrenz', 'Schwierige Rekrutierung', 'Zu wenig Zeit für Schulungen', 'Marktveränderungen'] },
        fr: { text: 'Quel est, selon toi, le plus grand obstacle à la croissance au cours des 3 prochaines années ?', options: ['Concurrence', 'Recrutement difficile', 'Peu de temps pour la formation', 'Changements du marché'] },
        es: { text: '¿Cuál es, en tu opinión, el mayor obstáculo para el crecimiento en los próximos 3 años?', options: ['Competencia', 'Reclutamiento difícil', 'Poco tiempo para la formación', 'Cambios del mercado'] },
        en: { text: 'What is the biggest obstacle to growth in the next 3 years, in your opinion?', options: ['Competition', 'Difficult recruitment', 'Not enough time for training', 'Market changes'] },
      },
    },
    {
      type: 'tf', correctIndex: 0, timeLimitSec: 15,
      translations: {
        it: { text: "Tra 3 anni l'AI sarà uno strumento quotidiano per la maggior parte del team", options: TF_LABELS.it },
        de: { text: 'In 3 Jahren wird KI für den größten Teil des Teams ein alltägliches Werkzeug sein', options: TF_LABELS.de },
        fr: { text: "Dans 3 ans, l'IA sera un outil quotidien pour la majorité de l'équipe", options: TF_LABELS.fr },
        es: { text: 'Dentro de 3 años, la IA será una herramienta diaria para la mayoría del equipo', options: TF_LABELS.es },
        en: { text: 'In 3 years, AI will be a daily tool for most of the team', options: TF_LABELS.en },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Che tipo di eventi vorresti di più nei prossimi 3 anni?', options: ['Grandi eventi nazionali', 'Eventi locali frequenti', 'Eventi online/ibridi', 'Viaggi incentive'] },
        de: { text: 'Welche Art von Events wünschst du dir am meisten in den nächsten 3 Jahren?', options: ['Große nationale Events', 'Häufige lokale Events', 'Online-/Hybrid-Events', 'Incentive-Reisen'] },
        fr: { text: "Quel type d'événements aimerais-tu le plus au cours des 3 prochaines années ?", options: ['Grands événements nationaux', 'Événements locaux fréquents', 'Événements en ligne/hybrides', 'Voyages incentive'] },
        es: { text: '¿Qué tipo de eventos te gustaría más en los próximos 3 años?', options: ['Grandes eventos nacionales', 'Eventos locales frecuentes', 'Eventos online/híbridos', 'Viajes incentivo'] },
        en: { text: 'What kind of events would you like most in the next 3 years?', options: ['Big national events', 'Frequent local events', 'Online/hybrid events', 'Incentive trips'] },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Qual è, secondo te, il traguardo più importante per i 28 anni di Idea Fresca?', options: ['Più partner nella rete', 'Più fatturato', 'Più riconoscibilità del brand', 'Più impatto nella formazione'] },
        de: { text: 'Was ist deiner Meinung nach der wichtigste Meilenstein für die 28 Jahre von Idea Fresca?', options: ['Mehr Partner im Netzwerk', 'Mehr Umsatz', 'Mehr Markenbekanntheit', 'Mehr Wirkung in der Ausbildung'] },
        fr: { text: 'Selon toi, quel est l’objectif le plus important pour les 28 ans d’Idea Fresca ?', options: ['Plus de partenaires dans le réseau', "Plus de chiffre d'affaires", 'Plus de notoriété de la marque', 'Plus d’impact dans la formation'] },
        es: { text: 'En tu opinión, ¿cuál es el hito más importante para los 28 años de Idea Fresca?', options: ['Más socios en la red', 'Más facturación', 'Más reconocimiento de marca', 'Más impacto en la formación'] },
        en: { text: "In your opinion, what is the most important milestone for Idea Fresca's 28th anniversary?", options: ['More partners in the network', 'More revenue', 'More brand recognition', 'More impact in training'] },
      },
    },
    {
      type: 'tf', correctIndex: 1, timeLimitSec: 15,
      translations: {
        it: { text: 'Tra 3 anni la formazione sarà soprattutto digitale, non più in presenza', options: TF_LABELS.it },
        de: { text: 'In 3 Jahren wird die Ausbildung vor allem digital sein, nicht mehr in Präsenz', options: TF_LABELS.de },
        fr: { text: 'Dans 3 ans, la formation sera surtout numérique, plus en présentiel', options: TF_LABELS.fr },
        es: { text: 'Dentro de 3 años, la formación será principalmente digital, ya no presencial', options: TF_LABELS.es },
        en: { text: 'In 3 years, training will be mostly digital, no longer in person', options: TF_LABELS.en },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Cosa ti rende più orgoglioso di far parte di Idea Fresca oggi?', options: ['Le relazioni costruite', 'La libertà che mi dà questo lavoro', 'La crescita personale che ho fatto', "L'impatto che ho sulla vita degli altri"] },
        de: { text: 'Worauf bist du heute am meisten stolz, Teil von Idea Fresca zu sein?', options: ['Die aufgebauten Beziehungen', 'Die Freiheit, die mir diese Arbeit gibt', 'Das persönliche Wachstum, das ich erreicht habe', 'Die Wirkung, die ich auf das Leben anderer habe'] },
        fr: { text: "Qu'est-ce qui te rend le plus fier de faire partie d'Idea Fresca aujourd'hui ?", options: ['Les relations construites', 'La liberté que ce travail me donne', "La croissance personnelle que j'ai accomplie", "L'impact que j'ai sur la vie des autres"] },
        es: { text: '¿Qué te hace sentir más orgulloso de formar parte de Idea Fresca hoy?', options: ['Las relaciones construidas', 'La libertad que me da este trabajo', 'El crecimiento personal que he logrado', 'El impacto que tengo en la vida de los demás'] },
        en: { text: 'What makes you most proud to be part of Idea Fresca today?', options: ["The relationships I've built", 'The freedom this job gives me', "The personal growth I've achieved", "The impact I have on other people's lives"] },
      },
    },
    {
      type: 'tf', correctIndex: 0, timeLimitSec: 15,
      translations: {
        it: { text: 'Nei momenti difficili, quello che mi fa continuare è più legato alle persone del team che ai risultati numerici', options: TF_LABELS.it },
        de: { text: 'In schwierigen Momenten ist das, was mich weitermachen lässt, eher mit den Menschen im Team verbunden als mit den Zahlen', options: TF_LABELS.de },
        fr: { text: "Dans les moments difficiles, ce qui me fait continuer est plus lié aux personnes de l'équipe qu'aux résultats chiffrés", options: TF_LABELS.fr },
        es: { text: 'En los momentos difíciles, lo que me hace seguir adelante está más relacionado con las personas del equipo que con los resultados numéricos', options: TF_LABELS.es },
        en: { text: 'In difficult moments, what keeps me going is more about the people on the team than the numbers', options: TF_LABELS.en },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'Qual è il mindset che vuoi portare con te nei prossimi 25 anni?', options: ['Coraggio di osare', 'Costanza nel tempo', 'Apertura al cambiamento', 'Gratitudine per il percorso fatto'] },
        de: { text: 'Welche Einstellung möchtest du mit dir für die nächsten 25 Jahre tragen?', options: ['Mut zu wagen', 'Beständigkeit über die Zeit', 'Offenheit für Veränderung', 'Dankbarkeit für den bisherigen Weg'] },
        fr: { text: "Quel état d'esprit veux-tu porter avec toi pour les 25 prochaines années ?", options: ["Le courage d'oser", 'La constance dans le temps', 'L’ouverture au changement', 'La gratitude pour le chemin parcouru'] },
        es: { text: '¿Qué mentalidad quieres llevar contigo durante los próximos 25 años?', options: ['Valentía para atreverse', 'Constancia en el tiempo', 'Apertura al cambio', 'Gratitud por el camino recorrido'] },
        en: { text: 'What mindset do you want to carry with you for the next 25 years?', options: ['Courage to dare', 'Consistency over time', 'Openness to change', 'Gratitude for the journey so far'] },
      },
    },
    {
      type: 'mc', correctIndex: 0, timeLimitSec: 20,
      translations: {
        it: { text: 'In una parola, cosa rappresentano per te questi 25 anni?', options: ['Famiglia', 'Crescita', 'Sfida', 'Eredità'] },
        de: { text: 'In einem Wort: Was bedeuten diese 25 Jahre für dich?', options: ['Familie', 'Wachstum', 'Herausforderung', 'Erbe'] },
        fr: { text: 'En un mot, que représentent pour toi ces 25 années ?', options: ['Famille', 'Croissance', 'Défi', 'Héritage'] },
        es: { text: 'En una palabra, ¿qué representan para ti estos 25 años?', options: ['Familia', 'Crecimiento', 'Desafío', 'Legado'] },
        en: { text: 'In one word, what do these 25 years represent for you?', options: ['Family', 'Growth', 'Challenge', 'Legacy'] },
      },
    },
  ],
};

function defaultQuestions() {
  return DEFAULT_QUIZ.questions.map((q) => ({
    type: q.type,
    correctIndex: q.correctIndex,
    correctIndexes: q.correctIndexes,
    timeLimitSec: q.timeLimitSec,
    translations: QUIZ_LANGS.reduce((acc, l) => {
      const t = q.translations[l] || q.translations.it;
      acc[l] = { text: t.text, options: [...t.options] };
      return acc;
    }, {}),
  }));
}

function freshState() {
  // Se è stato salvato un quiz su disco da una sessione precedente lo ricarichiamo (passandolo
  // comunque da sanitizeQuestions, la stessa validazione usata quando l'admin salva), altrimenti
  // si parte dalle 16 domande di default scritte nel codice.
  const saved = loadSavedQuiz();
  const savedQuestions = saved ? sanitizeQuestions(saved.questions) : null;
  const useSaved = !!(savedQuestions && savedQuestions.length);
  return {
    status: 'lobby', // lobby | question | reveal | leaderboard | finished
    screenLang: (saved && QUIZ_LANGS.includes(saved.screenLang)) ? saved.screenLang : DEFAULT_SCREEN_LANG,
    quizTitle: useSaved ? String(saved.title || 'Quiz').slice(0, 80) : DEFAULT_QUIZ.title.it,
    questions: useSaved ? savedQuestions : defaultQuestions(),
    showLeaderboardAfterEachQuestion: useSaved ? saved.showLeaderboardAfterEachQuestion !== false : true,
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

// Il maxischermo mostra la lingua scelta dal pannello admin (vedi azione 'set-screen-lang').
function publicQuestionForScreen(q) {
  if (!q) return null;
  const tr = q.translations[state.screenLang] || q.translations.it;
  return { text: tr.text, type: q.type, options: tr.options, timeLimitSec: q.timeLimitSec, index: state.currentIndex, total: state.questions.length };
}

// Ogni partecipante vede testo e opzioni nella propria lingua: mandiamo tutte le traduzioni
// (non è un'informazione sensibile, a differenza della risposta corretta che resta nascosta
// fino al reveal) e il telefono sceglie da solo quale mostrare in base alla lingua impostata.
function publicQuestionForPlayer(q) {
  if (!q) return null;
  const textByLang = {};
  const optionsByLang = {};
  QUIZ_LANGS.forEach((l) => {
    const tr = q.translations[l] || q.translations.it;
    textByLang[l] = tr.text;
    optionsByLang[l] = tr.options;
  });
  return {
    type: q.type,
    optionCount: q.translations.it.options.length,
    timeLimitSec: q.timeLimitSec,
    index: state.currentIndex,
    textByLang,
    optionsByLang,
  };
}

// Riepilogo personale di un giocatore (tutte le domande, con la sua risposta e il
// risultato), usato per il PDF scaricabile a fine partita. Rivela anche le risposte
// corrette: va bene solo perché la partita è già finita (controllato dal chiamante).
function buildMySummary(playerId) {
  const player = state.players[playerId];
  if (!player) return null;
  const items = state.questions.map((q, i) => {
    const h = player.history.find((x) => x.questionIndex === i);
    const textByLang = {};
    const optionsByLang = {};
    QUIZ_LANGS.forEach((l) => {
      const tr = q.translations[l] || q.translations.it;
      textByLang[l] = tr.text;
      optionsByLang[l] = tr.options;
    });
    return {
      textByLang,
      optionsByLang,
      type: q.type,
      correctIndex: q.type === 'multi' ? null : q.correctIndex,
      correctIndexes: q.type === 'multi' ? q.correctIndexes : null,
      myOptionIndex: h ? h.optionIndex : null,
      myOptionIndexes: h ? h.optionIndexes : null,
      answered: !!h,
      correct: h ? h.correct : false,
      points: h ? h.points : 0,
    };
  });
  return {
    quizTitle: state.quizTitle,
    nickname: player.nickname,
    totalScore: player.score,
    items,
  };
}

// Chi non ha mai inviato la risposta definitiva a una domanda a selezione multipla (telefono
// andato in background, o l'admin che passa avanti/termina la partita senza prima rivelare la
// risposta) viene finalizzato qui con l'ultima bozza salvata da update-multi-answer, invece di
// risultare "nessuna risposta" a vuoto. Richiamata da reveal, start-question ed end-game.
function finalizeMultiDrafts(questionIndex) {
  if (questionIndex == null || questionIndex < 0) return;
  const q = state.questions[questionIndex];
  if (!q || q.type !== 'multi') return;
  const correctSet = new Set(q.correctIndexes);
  Object.values(state.players).forEach((p) => {
    if (p.answered[questionIndex] != null) return;
    const draft = p.draftAnswers && p.draftAnswers[questionIndex];
    if (!draft) return;
    const correct = draft.length === correctSet.size && draft.every((i) => correctSet.has(i));
    const points = correct ? BASE_POINTS : 0;
    p.answered[questionIndex] = true;
    p.score += points;
    p.history.push({ questionIndex, optionIndex: null, optionIndexes: draft, correct, points, elapsedMs: null });
  });
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
    const rawTr = q.translations || {};
    const itRaw = rawTr.it || {};
    const itText = String(itRaw.text || '').slice(0, 200).trim();
    if (!itText) return null;

    let optionCount;
    let itOptions;
    if (type === 'tf') {
      optionCount = 2;
      itOptions = TF_LABELS.it;
    } else {
      itOptions = (Array.isArray(itRaw.options) ? itRaw.options : []).map((o) => String(o || '').slice(0, 80));
      if (itOptions.filter((o) => o.trim().length > 0).length < 2) return null;
      optionCount = itOptions.length;
    }

    const translations = {};
    QUIZ_LANGS.forEach((l) => {
      const t = rawTr[l] || {};
      const text = String(t.text || '').slice(0, 200).trim() || itText;
      let options;
      if (type === 'tf') {
        options = TF_LABELS[l] || TF_LABELS.it;
      } else {
        const provided = Array.isArray(t.options) ? t.options.map((o) => String(o || '').slice(0, 80)) : [];
        options = [];
        for (let i = 0; i < optionCount; i++) {
          const v = (provided[i] || '').trim();
          options.push(v || itOptions[i] || '');
        }
      }
      translations[l] = { text, options };
    });

    const timeLimitSec = Math.min(120, Math.max(5, Number(q.timeLimitSec) || DEFAULT_TIME_LIMIT));

    if (type === 'multi') {
      let correctIndexes = Array.isArray(q.correctIndexes)
        ? [...new Set(q.correctIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount))]
        : [];
      if (!correctIndexes.length) correctIndexes = [0];
      return { type, translations, correctIndexes, timeLimitSec };
    }
    let correctIndex = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
    if (correctIndex < 0 || correctIndex >= optionCount) correctIndex = 0;
    return { type, translations, correctIndex, timeLimitSec };
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
    "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; " +
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
  const questions = state.questions.map((q) => ({
    text: q.translations.it.text,
    options: q.translations.it.options,
    correctIndex: q.correctIndex,
    correctIndexes: q.correctIndexes,
  }));
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
    screenLang: state.screenLang,
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
    const optionCount = q.translations.it.options.length;
    let correct, points, chosenIndexes;
    if (q.type === 'multi') {
      // Selezione multipla: il telefono invia la risposta solo allo scadere del tempo (nessun
      // bonus di velocità), corretta solo se l'insieme scelto coincide esattamente con quello giusto.
      chosenIndexes = Array.isArray(optionIndexes)
        ? [...new Set(optionIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount))]
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

  // Selezione multipla: il telefono manda qui la selezione ad OGNI tocco (non solo a fine
  // tempo), così il server ha sempre l'ultima scelta anche se il browser va in background e il
  // timer che dovrebbe far scattare l'invio finale viene sospeso dal telefono (succede spesso
  // quando si blocca lo schermo) — senza questo, quella risposta andrebbe persa del tutto.
  // Non assegna ancora punti: è solo una bozza, finalizzata e punteggiata al momento del reveal.
  socket.on('update-multi-answer', ({ playerId, questionIndex, optionIndexes }) => {
    if (state.status !== 'question' || questionIndex !== state.currentIndex) return;
    const player = state.players[playerId];
    const q = currentQuestion();
    if (!player || !q || q.type !== 'multi') return;
    if (player.answered[questionIndex] != null) return; // già inviata la risposta definitiva
    const optionCount = q.translations.it.options.length;
    const clean = Array.isArray(optionIndexes)
      ? [...new Set(optionIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount))]
      : [];
    if (!player.draftAnswers) player.draftAnswers = {};
    player.draftAnswers[questionIndex] = clean;
  });

  // Riepilogo personale per il PDF scaricabile dal proprio telefono: lo diamo solo a
  // partita finita, altrimenti un partecipante potrebbe scoprire in anticipo le risposte
  // corrette delle domande non ancora fatte. Il playerId arriva esplicitamente dal
  // telefono (come già fa submit-answer), non da socket.data: dopo una riconnessione
  // (schermo bloccato, pagina ricaricata, rete che va e viene) il telefono ha sempre il suo
  // playerId salvato, ma la nuova connessione socket non sa più a quale giocatore corrisponde
  // finché non rifà il join — con questo approccio non serve rifarlo.
  socket.on('request-my-summary', ({ playerId } = {}) => {
    if (state.status !== 'finished') return;
    if (!playerId || !state.players[playerId]) return;
    const summary = buildMySummary(playerId);
    if (summary) socket.emit('my-summary', summary);
  });

  socket.on('admin', ({ pin, action, payload }) => {
    if (pin !== ADMIN_PIN) {
      socket.emit('admin:error', { message: 'PIN errato', code: 'bad_pin' });
      return;
    }
    switch (action) {
      case 'set-screen-lang': {
        const lang = payload && payload.lang;
        if (!QUIZ_LANGS.includes(lang)) return;
        state.screenLang = lang;
        saveQuizToDisk();
        // Evento dedicato (non un 'init' completo): aggiorna solo il testo mostrato, senza
        // toccare il timer della domanda eventualmente già in corso.
        io.emit('screen-lang:update', {
          screenLang: state.screenLang,
          question: state.status === 'question' ? publicQuestionForScreen(currentQuestion()) : null,
        });
        return;
      }
      case 'set-quiz': {
        state.quizTitle = String((payload && payload.title) || 'Quiz').slice(0, 80);
        state.questions = sanitizeQuestions(payload && payload.questions);
        state.showLeaderboardAfterEachQuestion = !(payload && payload.showLeaderboardAfterEachQuestion === false);
        state.currentIndex = -1;
        state.status = 'lobby';
        saveQuizToDisk();
        io.emit('init', initPayload());
        return;
      }
      case 'start-question': {
        if (!state.questions.length) return;
        // Se si passa alla prossima domanda SENZA aver premuto "Mostra risposta corretta" per
        // quella attiva, finalizziamo comunque le bozze di selezione multipla rimaste in sospeso
        // prima di abbandonarla — altrimenti andrebbero perse senza mai contare come risposte.
        if (state.status === 'question') finalizeMultiDrafts(state.currentIndex);
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
        const optionCount = q.translations.it.options.length;
        finalizeMultiDrafts(state.currentIndex);
        const counts = new Array(optionCount).fill(0);
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
          options: (q.translations[state.screenLang] || q.translations.it).options,
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
        // Stesso discorso: se si termina la partita con una domanda a selezione multipla ancora
        // attiva e mai rivelata, le bozze vanno finalizzate ora, altrimenti si perdono.
        if (state.status === 'question') finalizeMultiDrafts(state.currentIndex);
        state.status = 'finished';
        io.emit('game:finished', { players: publicPlayerList() });
        return;
      }
      case 'reset': {
        // "Nuova partita": azzera solo giocatori/punteggi, NON il quiz configurato — altrimenti
        // ogni reset butterebbe via le domande salvate e farebbe tornare quelle di default.
        state = {
          status: 'lobby',
          screenLang: state.screenLang,
          quizTitle: state.quizTitle,
          questions: state.questions,
          showLeaderboardAfterEachQuestion: state.showLeaderboardAfterEachQuestion,
          currentIndex: -1,
          currentStartedAt: null,
          currentAnswersCount: 0,
          players: {},
        };
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
        const questions = state.questions.map((q) => ({
          text: q.translations.it.text,
          options: q.translations.it.options,
          correctIndex: q.correctIndex,
          correctIndexes: q.correctIndexes,
        }));
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
