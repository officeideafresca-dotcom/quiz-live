# Quiz Live

App quiz dal vivo stile Kahoot: QR code per entrare (nessuna installazione, nessun login),
domande a tempo, punteggio in base a velocità e correttezza, classifica in diretta sul
maxischermo. **Riutilizzabile per qualsiasi evento** — non è legata a Idea Fresca 25 Anni,
è un progetto separato.

## Come funziona

- **Partecipanti** (`/`): scansionano il QR, scrivono un nickname (nessun account), e durante
  ogni domanda vedono il testo e le opzioni **tradotti nella propria lingua** (IT/DE/FR/ES/EN,
  rilevata dal telefono o cambiabile a mano) insieme alle forme/colori da toccare. Il punteggio
  premia velocità + correttezza (risposta corretta istantanea = 1000 punti, via via meno punti
  più tardi si risponde entro il tempo limite, 0 se sbagliata).
- **Schermo grande** (`/screen`): QR + elenco di chi si è iscritto in lobby, poi domanda +
  countdown + opzioni colorate, poi il reveal con un grafico di quante persone hanno scelto
  ogni risposta, poi la classifica, fino al podio finale. Mostra sempre **una sola lingua a
  scelta** (di default l'inglese), impostabile dal pannello admin — vedi sotto.
- **Pannello di regia** (`/admin`): protetto da PIN, da aprire sul tuo telefono/laptop
  personale. Da qui crei il quiz (titolo + domande, con tempo limite personalizzabile per
  ciascuna), controlli il ritmo del gioco (avvia domanda → mostra risposta → mostra classifica
  → ripeti → termina), e **scarichi i risultati** in CSV o in un **riepilogo PDF** con il
  dettaglio di ogni domanda (quante persone hanno scelto ciascuna opzione) — senza nessun
  paywall, a differenza di Kahoot/Quizizz dove l'export è spesso bloccato dietro un piano a
  pagamento.
- **A fine partita**, ogni partecipante può scaricare dal proprio telefono un **PDF personale**
  con tutte le domande, la propria risposta e il risultato — un tocco su "Scarica il tuo
  riepilogo (PDF)" nella schermata finale.

### Tre tipi di domanda

1. **Scelta singola**: 2-4 opzioni, una sola è corretta (scelta con il pallino nell'editor). Sul
   telefono basta un tocco: la risposta parte subito e premia anche la velocità (più rispondi in
   fretta, più punti fai se è corretta).
2. **Selezione multipla**: 2-4 opzioni, più di una può essere corretta (le spunti con il
   checkbox nell'editor — segnala quali). Sul telefono i partecipanti possono toccare e
   ritoccare più opzioni per accenderle/spegnerle finché vogliono, senza bisogno di un bottone
   "conferma" — ogni tocco manda già al server la selezione attuale (come bozza), così anche se
   il telefono va in background (schermo bloccato, cambio app) e il conto alla rovescia finale
   non riesce a scattare da solo, l'ultima scelta non va persa: viene comunque finalizzata e
   punteggiata al momento del reveal. È corretta solo se l'insieme scelto coincide esattamente
   con quello giusto (nessuna corretta mancante, nessuna sbagliata in più) — altrimenti 0 punti;
   non c'è bonus di velocità, dato che non si registra un orario di invio univoco.
3. **Vero / Falso**: come la scelta singola, con due sole opzioni fisse.

Sul maxischermo il reveal mostra sempre il grafico con quante persone hanno scelto ogni opzione
e marca con un ✓ tutte le risposte corrette (una o più, secondo il tipo di domanda).

### Lingue: schermo vs partecipanti

Ogni domanda si scrive (o traduce) in 5 lingue — IT/DE/FR/ES/EN — direttamente nell'editor
dell'admin, con una linguetta per lingua sopra il testo della domanda:

- **Sullo smartphone**, ogni partecipante vede sempre testo e opzioni nella propria lingua
  (rilevata automaticamente, cambiabile con il selettore in alto). Lingue senza traduzione
  scritta mostrano l'italiano come ripiego.
- **Sul maxischermo** si vede sempre una sola lingua per tutti, scelta dal pannello admin nel
  box "Lingua maxischermo" (di default inglese). Cambiarla durante una domanda già partita
  aggiorna subito il testo mostrato senza riavviare il conto alla rovescia.

Solo il testo in **italiano** è obbligatorio per salvare una domanda: le altre lingue sono
facoltative e, se lasciate vuote, usano l'italiano come ripiego sia sullo smartphone che sul
maxischermo.

## Avvio rapido (in locale)

```bash
npm install
npm start
```

Il terminale stampa gli indirizzi (partecipanti, schermo, regia) e il PIN admin di default
(`2525`, cambiabile con la variabile d'ambiente `ADMIN_PIN`).

## Pubblicare online su Render (per funzionare da qualsiasi rete, non solo il Wi-Fi della sala)

Stessa procedura già vista per Idea Fresca 25 Anni:

1. Crea un repository GitHub (vuoto, senza README) e carica dentro tutta questa cartella
   trascinando i file nella pagina "uploading an existing file" (o con GitHub Desktop)
2. Su [render.com](https://render.com), **New +** → **Blueprint**, collega il repository:
   Render legge da solo il file `render.yaml` già incluso e ti chiede il valore di `ADMIN_PIN`
3. Dopo il deploy avrai un indirizzo pubblico — apri `/screen` sul proiettore e `/admin` sul
   tuo telefono; il QR su `/screen` punta già automaticamente all'indirizzo giusto

**Promemoria**: dopo ogni aggiornamento del codice, ricordati di fare un **refresh (F5)** sia
su `/screen` sia su `/admin` prima di usarli — una pagina già aperta non si aggiorna da sola.

## Come creare un quiz

Nel pannello `/admin`, sezione "Crea / modifica quiz":
1. Scrivi il titolo del quiz
2. Scegli **quando mostrare la classifica**: "Dopo ogni domanda" (più feedback frequente) o
   "Solo alla fine" (tutta la suspense riservata al podio finale) — con questa seconda opzione
   il pulsante "Mostra classifica" resta disattivato fino a "Termina partita"
3. Per ogni domanda: scegli il tipo (Scelta singola, Selezione multipla o Vero/Falso), scrivi
   testo e opzioni per ogni lingua che vuoi coprire (linguette IT/DE/FR/ES/EN, solo l'italiano è
   obbligatorio), segna quale/quali opzioni sono corrette, imposta il tempo limite in secondi
4. "+ Aggiungi domanda" per le successive, poi **"Salva quiz"**

Durante l'evento: **"▶ Avvia prossima domanda"** fa partire la domanda successiva in coda
(puoi ripeterlo quante volte vuoi, avanza automaticamente), **"Mostra risposta corretta"**
blocca le risposte e rivela il risultato con il grafico delle scelte, **"Mostra classifica"**
mostra la classifica aggiornata, **"Termina partita"** chiude il gioco con il podio finale e
**scarica subito da solo CSV e PDF** sul dispositivo dell'admin — non c'è bisogno di ricordarsi
di premere altri bottoni dopo: lo stato è solo in memoria e un riavvio del server lo cancella.

## Collegamento con Idea Fresca 25 Anni

L'app Idea Fresca 25 Anni può leggere in automatico il riepilogo del quiz (classifica e %
di risposte corrette) tramite l'endpoint `GET /api/results?pin=<ADMIN_PIN>` — protetto dallo
stesso PIN admin di questa app, passato come query string. Non va mai chiamato da una pagina
pubblica: serve solo per il collegamento server-a-server tra le due app. Non richiede nessuna
configurazione aggiuntiva qui: basta che l'altra app conosca l'URL pubblico e il PIN di questa.

## Note tecniche

- **I risultati di una partita (giocatori, punteggi, risposte) vivono solo in memoria** —
  pensati per una sessione di gioco, non per uno storico tra eventi diversi. Se vuoi tenerli,
  scarica il CSV o il PDF (si scaricano già da soli quando premi "Termina partita").
- **Il quiz che configuri (titolo, domande, traduzioni, lingua schermo) invece viene anche
  salvato su un file su disco** (`data/quiz.json`, creato/aggiornato automaticamente a ogni
  "Salva quiz") e ricaricato da lì quando il server si riavvia — es. dopo un crash o un
  risveglio dallo standby del piano gratuito Render. "Reset completo (nuova partita)" azzera
  solo giocatori e punteggi, non il quiz salvato.
  **⚠️ Limite importante**: questo file sopravvive solo se il server riparte sullo stesso
  disco. Un **vero nuovo deploy** (pubblichi un aggiornamento del codice) crea su Render — e
  su molte altre piattaforme col piano gratuito — un disco completamente nuovo e vuoto: in
  quel caso il file si perde comunque e si torna alle 16 domande di default scritte nel
  codice. Per una garanzia vera a prova di deploy servirebbe un database esterno o un disco
  persistente (piano a pagamento).
- **Per questo**, nel riquadro "Crea / modifica quiz" c'è anche **"Scarica quiz (backup)"** /
  **"Carica quiz da backup"**: scarica il quiz configurato come file sul tuo dispositivo (non
  sul server, quindi sopravvive a qualsiasi deploy) e ricaricalo con un tocco quando serve. È
  la copia di sicurezza vera — usala dopo ogni modifica importante, e prima di pubblicare un
  aggiornamento del codice, così non perdi mai il lavoro fatto.
- Fino a 300 giocatori e 50 domande per partita (limiti modificabili in `server.js`).
- I giocatori si riconnettono automaticamente con lo stesso punteggio se ricaricano la pagina
  durante la stessa partita (l'identità resta salvata nel browser del telefono).
- I PDF (personale e admin) sono generati nel browser con la libreria [jsPDF](https://github.com/parallax/jsPDF),
  caricata da cdnjs.cloudflare.com — l'unico script esterno ammesso dalla Content-Security-Policy
  del sito, tutto il resto resta servito dal server stesso.
