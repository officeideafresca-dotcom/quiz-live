# Quiz Live

App quiz dal vivo stile Kahoot: QR code per entrare (nessuna installazione, nessun login),
domande a tempo, punteggio in base a velocità e correttezza, classifica in diretta sul
maxischermo. **Riutilizzabile per qualsiasi evento** — non è legata a Idea Fresca 25 Anni,
è un progetto separato.

## Come funziona

- **Partecipanti** (`/`): scansionano il QR, scrivono un nickname (nessun account), e durante
  ogni domanda vedono **solo forme/colori** da toccare (come su Kahoot) — il testo della
  domanda e le opzioni compaiono solo sul maxischermo, per spingere il gruppo a guardare lì.
  Il punteggio premia velocità + correttezza (risposta corretta istantanea = 1000 punti,
  via via meno punti più tardi si risponde entro il tempo limite, 0 se sbagliata).
- **Schermo grande** (`/screen`): QR + elenco di chi si è iscritto in lobby, poi domanda +
  countdown + opzioni colorate, poi il reveal con un grafico di quante persone hanno scelto
  ogni risposta, poi la classifica, fino al podio finale.
- **Pannello di regia** (`/admin`): protetto da PIN, da aprire sul tuo telefono/laptop
  personale. Da qui crei il quiz (titolo + domande, con tempo limite personalizzabile per
  ciascuna), controlli il ritmo del gioco (avvia domanda → mostra risposta → mostra classifica
  → ripeti → termina), e **scarichi i risultati completi in CSV** (punteggio e risposta data da
  ogni partecipante per ogni domanda) — senza nessun paywall, a differenza di Kahoot/Quizizz
  dove l'export è spesso bloccato dietro un piano a pagamento.

### Tre tipi di domanda

1. **Scelta singola**: 2-4 opzioni, una sola è corretta (scelta con il pallino nell'editor). Sul
   telefono basta un tocco: la risposta parte subito e premia anche la velocità (più rispondi in
   fretta, più punti fai se è corretta).
2. **Selezione multipla**: 2-4 opzioni, più di una può essere corretta (le spunti con il
   checkbox nell'editor — segnala quali). Sul telefono i partecipanti possono toccare e
   ritoccare più opzioni per accenderle/spegnerle finché vogliono: la risposta (con tutto ciò che
   hanno selezionato in quel momento) parte in automatico solo allo scadere del tempo, senza
   bisogno di un bottone "conferma". È corretta solo se l'insieme scelto coincide esattamente con
   quello giusto (nessuna corretta mancante, nessuna sbagliata in più) — altrimenti 0 punti; non
   c'è bonus di velocità, dato che l'invio avviene sempre a fine tempo.
3. **Vero / Falso**: come la scelta singola, con due sole opzioni fisse.

Sul maxischermo il reveal mostra sempre il grafico con quante persone hanno scelto ogni opzione
e marca con un ✓ tutte le risposte corrette (una o più, secondo il tipo di domanda).

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
3. Per ogni domanda: testo, tipo (Scelta multipla 2-4 opzioni, oppure Vero/Falso), segna con il
   pallino quale opzione è quella corretta, imposta il tempo limite in secondi
4. "+ Aggiungi domanda" per le successive, poi **"Salva quiz"**

Durante l'evento: **"▶ Avvia prossima domanda"** fa partire la domanda successiva in coda
(puoi ripeterlo quante volte vuoi, avanza automaticamente), **"Mostra risposta corretta"**
blocca le risposte e rivela il risultato con il grafico delle scelte, **"Mostra classifica"**
mostra la classifica aggiornata, **"Termina partita"** chiude il gioco con il podio finale.

## Collegamento con Idea Fresca 25 Anni

L'app Idea Fresca 25 Anni può leggere in automatico il riepilogo del quiz (classifica e %
di risposte corrette) tramite l'endpoint `GET /api/results?pin=<ADMIN_PIN>` — protetto dallo
stesso PIN admin di questa app, passato come query string. Non va mai chiamato da una pagina
pubblica: serve solo per il collegamento server-a-server tra le due app. Non richiede nessuna
configurazione aggiuntiva qui: basta che l'altra app conosca l'URL pubblico e il PIN di questa.

## Note tecniche

- Stato in memoria (nessun database): pensato per una sessione di gioco, non per conservare
  storico tra eventi diversi. Se vuoi tenere i risultati, scarica il CSV prima di premere Reset.
- Fino a 300 giocatori e 50 domande per partita (limiti modificabili in `server.js`).
- I giocatori si riconnettono automaticamente con lo stesso punteggio se ricaricano la pagina
  durante la stessa partita (l'identità resta salvata nel browser del telefono).
