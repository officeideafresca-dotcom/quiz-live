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
  personale. Da qui crei il quiz (titolo + domande a scelta multipla o Vero/Falso, con tempo
  limite personalizzabile per ciascuna), controlli il ritmo del gioco (avvia domanda → mostra
  risposta → mostra classifica → ripeti → termina), e **scarichi i risultati completi in CSV**
  (punteggio e risposta data da ogni partecipante per ogni domanda) — senza nessun paywall,
  a differenza di Kahoot/Quizizz dove l'export è spesso bloccato dietro un piano a pagamento.

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
2. Per ogni domanda: testo, tipo (Scelta multipla 2-4 opzioni, oppure Vero/Falso), segna con il
   pallino quale opzione è quella corretta, imposta il tempo limite in secondi
3. "+ Aggiungi domanda" per le successive, poi **"Salva quiz"**

Durante l'evento: **"▶ Avvia prossima domanda"** fa partire la domanda successiva in coda
(puoi ripeterlo quante volte vuoi, avanza automaticamente), **"Mostra risposta corretta"**
blocca le risposte e rivela il risultato con il grafico delle scelte, **"Mostra classifica"**
mostra la classifica aggiornata, **"Termina partita"** chiude il gioco con il podio finale.

## Note tecniche

- Stato in memoria (nessun database): pensato per una sessione di gioco, non per conservare
  storico tra eventi diversi. Se vuoi tenere i risultati, scarica il CSV prima di premere Reset.
- Fino a 300 giocatori e 50 domande per partita (limiti modificabili in `server.js`).
- I giocatori si riconnettono automaticamente con lo stesso punteggio se ricaricano la pagina
  durante la stessa partita (l'identità resta salvata nel browser del telefono).
