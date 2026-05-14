# andy code cat — Product Vision & Vertical Strategy

> Documento di visione prodotto. Non contiene istruzioni di codice ma direzioni strategiche, funzionalità UX ad alto e medio livello, e implicazioni di sviluppo per ciascuna verticale di mercato. Il documento è pensato come contesto applicativo per orientare le decisioni di sviluppo, non come specifica tecnica.

---

## Indice

1. [Fondamenta trasversali — Feature core e direzioni generali](#1-fondamenta-trasversali)
2. [Verticale: Web Agency & Freelance](#2-verticale-web-agency--freelance)
3. [Verticale: Scuole & Università](#3-verticale-scuole--università)
4. [Verticale: No Profit & Associazioni](#4-verticale-no-profit--associazioni)
5. [Verticale: Piccola Impresa — SaaS diretto](#5-verticale-piccola-impresa--saas-diretto)
6. [Verticale: Venditori di Spazi Pubblicitari](#6-verticale-venditori-di-spazi-pubblicitari)
7. [Verticale: Eventi & Fiere — Postazioni Fisiche](#7-verticale-eventi--fiere--postazioni-fisiche)
8. [Verticale: Gaming & Community](#8-verticale-gaming--community)
9. [Verticale: Developer & Open Source](#9-verticale-developer--open-source)
10. [Layer trasversali — Pre-prompting, Branding, Moderazione](#10-layer-trasversali)
11. [Roadmap per priorità](#11-roadmap-per-priorità)

---

## 1. Fondamenta trasversali

Andy è un generatore di contenuti visivi web self-contained. Il suo valore centrale è la capacità di trasformare un'intenzione testuale in un artefatto web funzionante, esportabile e indipendente. Tutto il lavoro di personalizzazione verticale si innesta su questo nucleo.

### 1.1 Il motore di pre-prompting

Il pre-prompting è il differenziatore principale di andy rispetto a un semplice wrapper LLM. Non si tratta di costruire prompt migliori per l'utente, ma di creare un sistema di layer componibili che avvolgono l'intenzione dell'utente con contesto, vincoli, stile e obiettivi che l'utente non deve conoscere né gestire.

**Direzioni di sviluppo:**

- Sistema di layer componibili e impilabili, dove ogni layer aggiunge o vincola il contesto della generazione
- Layer separati per: identità visiva, tono di voce, formato di output, vincoli etici, assets obbligatori
- Possibilità di layer utente (ciò che scrive), layer operatore (ciò che l'installazione aggiunge), layer brand (ciò che il cliente finale impone)
- Interfaccia di gestione layer accessibile solo all'amministratore dell'istanza
- Layer esportabili e importabili come configurazione, così che una verticale possa essere replicata su più installazioni

### 1.2 Multi-modello e multi-provider come infrastruttura

La scelta del modello non è un dettaglio tecnico ma una dimensione di prodotto. Diversi verticali richiedono diversi profili: velocità, qualità, privacy, costo, disponibilità offline.

**Direzioni di sviluppo:**

- Selezione del modello separata per fase di ottimizzazione e fase di generazione — i due momenti hanno profili diversi
- Profili di modello pre-configurati per verticale (es. "scuola" suggerisce automaticamente modelli locali)
- Gestione centralizzata delle API key con quota per utente e per tenant
- Fallback automatico tra provider in caso di errore o indisponibilità
- Indicatore di costo stimato prima della generazione, configurabile per essere visibile o nascosto all'utente finale
- Supporto a modelli locali come Ollama e LM Studio come opzione first-class, non come integrazione di secondo livello

### 1.3 L'output come artefatto portabile

Il valore dell'output ZIP non è solo tecnico. È una promessa di libertà: il contenuto generato appartiene a chi lo ha richiesto, funziona ovunque, non richiede abbonamenti né cloud per essere pubblicato.

**Direzioni di sviluppo:**

- Output sempre e comunque self-contained: zero dipendenze esterne, zero CDN, zero richieste di rete in runtime
- Opzione di pubblicazione diretta su dominio gestito dall'istanza andy
- Galleria pubblica o privata degli output generati, con controllo di visibilità
- Storico delle generazioni con possibilità di rieditare, rigenerare o forkare un output precedente
- Versioning degli output: ogni rigenerazione crea una nuova versione, le precedenti sono accessibili
- Export in formati alternativi dove applicabile (PDF da HTML, immagine da slide)

### 1.4 L'editor come ambiente creativo

L'editor WYSIWYG e l'editor HTML sono oggi strumenti di rifinitura. La direzione è renderli ambienti creativi a pieno titolo, non solo correttori di output.

**Direzioni di sviluppo:**

- Editing in-place con rigenerazione parziale: seleziona un elemento e richiedine la rigenerazione senza toccare il resto
- Suggerimenti contestuali durante l'editing, basati sul tipo di contenuto selezionato
- Blocchi di contenuto componibili: non tutto deve essere generato in un unico shot, si possono comporre sezioni
- Modalità di editing "guida": l'utente indica la direzione, andy aggiusta
- Undo/redo multi-livello con differenza visiva tra stati
- Anteprima responsive integrata (mobile, tablet, desktop) senza uscire dall'editor

---

## 2. Verticale: Web Agency & Freelance

### Contesto

Il CEO di web agency non usa andy direttamente: lo configura e lo delega ai propri collaboratori o lo integra nei flussi di produzione per i clienti. Il valore non è la singola generazione ma la capacità di industrializzare la produzione di contenuti mantenendo qualità e coerenza di brand.

### Funzionalità ad alto livello

**Gestione multi-cliente (tenant)**
Ogni cliente dell'agenzia è un'entità separata con il proprio brand kit, i propri layer di pre-prompting, i propri utenti abilitati e la propria galleria di output. L'agenzia gestisce tutti i tenant da un pannello unico. Ogni tenant vede solo i propri contenuti.

**Brand kit per cliente**
Un brand kit è l'insieme di informazioni che andy usa per orientare ogni generazione: palette colori, font, logo, tono di voce, settore, parole da usare e parole da evitare, formato preferito. Il brand kit non è visibile all'utente finale, ma avvolge ogni sua richiesta.

**Template di output proprietari**
L'agenzia può definire template di struttura — non di stile — che guidano la forma dell'output. Un template "landing page per ristorante" definisce le sezioni attese (hero, menu, contatti, mappa) lasciando la generazione libera di riempirle. I template sono asset dell'agenzia, non dell'utente.

**Workflow di approvazione**
Ogni output generato dal cliente può essere inviato in revisione all'agenzia prima della pubblicazione. L'agenzia approva, richiede modifiche o rifiuta. Il flusso è asincrono e notificato.

**Reportistica produzione**
Quante generazioni ha richiesto ogni cliente? Quali formati? Quali modelli sono stati usati? Qual è il costo stimato dei token? Questi dati alimentano la fatturazione e la pianificazione.

### Funzionalità a medio livello

- Clonazione rapida di brand kit tra clienti simili
- Pre-visualizzazione del brand kit su un output di esempio prima di attivarlo
- Libreria di asset condivisi tra tenant (icone, pattern, elementi grafici dell'agenzia)
- Limite di generazioni mensili per cliente, configurabile per piano commerciale
- Accesso API per integrare andy nel CMS o nel gestionale dell'agenzia
- Storico delle versioni per cliente, con possibilità di rollback
- Esportazione dell'intero parco output di un cliente in ZIP archivio

### Implicazioni di sviluppo

Il sistema di multi-tenancy è la feature abilitante per questa verticale. Senza di essa andy è uno strumento individuale, non un prodotto d'agenzia. La struttura dati degli utenti, dei brand kit e degli output deve prevedere fin dall'inizio la separazione per tenant. Il workflow di approvazione richiede un sistema di stato degli output (bozza, in revisione, approvato, pubblicato). La reportistica richiede logging delle generazioni con metadati (costo, modello, formato, utente, tenant).

---

## 3. Verticale: Scuole & Università

### Contesto

Andy in contesto scolastico non è un assistente, è uno strumento didattico. L'obiettivo non è produrre il contenuto migliore ma far vivere all'utente — lo studente — il processo di produzione. La qualità dell'output è secondaria rispetto alla qualità dell'esperienza di apprendimento.

### Funzionalità ad alto livello

**Modalità laboratorio**
Una modalità operativa alternativa alla normale interfaccia, pensata per sessioni guidate. Il docente definisce un percorso: tema, vincoli di prompt, modello da usare, formato di output. Lo studente opera entro questi vincoli. La modalità laboratorio mostra i passaggi in modo esplicito, rende visibile il prompt ottimizzato, mostra il processo invece di nasconderlo.

**Bacheca creativa scolastica**
Una galleria pubblica (ma moderata) degli output generati dagli studenti, ospitata sul dominio dell'istituto. Gli studenti vedono i propri lavori pubblicati, i docenti moderano. La bacheca è un artefatto educativo in sé: motiva, crea confronto, mostra l'evoluzione nel tempo.

**Profili modello per contesto scolastico**
In ambito scolastico la privacy degli studenti è un vincolo non negoziabile. Andy deve rendere semplice e sicuro l'uso esclusivo di modelli locali, senza richiedere competenze tecniche al docente. Un profilo "scuola" configura automaticamente: nessun dato inviato a provider esterni, modello locale pre-selezionato, log minimi.

**Percorsi di prompting strutturati**
Sequenze guidate di prompting progressivo: il docente definisce una sequenza di esercizi in cui ogni step costruisce sul precedente. Lo studente impara a raffinare, specificare, correggere il proprio prompt osservando come cambia l'output.

**Valutazione del prompt**
Non dell'output, ma del prompt. Un sotto-sistema che analizza la qualità e la specificità del prompt scritto dallo studente e fornisce un feedback formativo: è troppo vago? manca di contesto? usa parole ambigue? Questo è uno strumento per il docente, non un giudice automatico.

### Funzionalità a medio livello

- Esportazione degli output degli studenti in formato archivio per valutazione docente
- Integrazione con sistemi di registro elettronico (via API) per associare output a studenti e classi
- Modalità anonima per esercizi in cui l'identità non deve influenzare la valutazione
- Timer di sessione per esercizi cronometrati
- Confronto affiancato di output generati da prompt diversi sullo stesso tema
- Dashboard docente con panoramica dell'attività della classe
- Soglia di moderazione configurabile per la bacheca (manuale, semi-automatica)

### Implicazioni di sviluppo

La modalità laboratorio richiede un livello di configurazione della sessione non previsto dall'architettura standard. È essenzialmente un secondo entry point all'applicazione con un flusso UX completamente diverso. La bacheca scolastica richiede un sistema di moderazione con ruoli (studente, docente, amministratore istituto). Il profilo "scuola privacy-first" richiede che il routing verso provider cloud sia disabilitabile a livello di istanza, non solo di singolo utente.

---

## 4. Verticale: No Profit & Associazioni

### Contesto

Le organizzazioni no profit hanno risorse limitate, competenze digitali eterogenee e bisogni comunicativi concreti: annunci, volantini, moduli, landing per campagne. Andy deve essere per loro lo strumento più semplice possibile, con la minima curva di apprendimento e il massimo effetto pratico.

### Funzionalità ad alto livello

**Template operativi per tipologia di contenuto associativo**
Modelli di output pre-configurati per le esigenze tipiche: volantino evento, pagina raccolta fondi, form di iscrizione, comunicato stampa visivo, aggiornamento per i volontari. Ogni template non è un layout fisso ma un insieme di intenzioni e strutture che guidano la generazione nella direzione giusta.

**Modalità semplificata**
Un'interfaccia ridotta all'essenziale: scrivi cosa ti serve, scegli il formato, genera. Nessun riferimento a LLM, provider, token, pre-prompting. Andy decide per l'utente. La modalità semplificata è il default per questa verticale, la modalità avanzata è accessibile ma non in primo piano.

**Export ottimizzato per stampa e social**
Il no profit ha bisogno di volantini fisici e post social, non solo di pagine web. Export in PDF con margini di stampa corretti, export in formato immagine per le dimensioni dei principali social network, export in formato A4 pronto per la tipografia.

**Libreria di contenuti riutilizzabili**
L'associazione accumula nel tempo contenuti che si ripetono: la propria storia, la propria mission, i propri contatti, le foto degli eventi. Andy dovrebbe poter attingere a questa libreria durante la generazione senza che l'utente debba riscriverla ogni volta.

### Funzionalità a medio livello

- Condivisione dell'account tra volontari con ruoli differenziati
- Notifica ai volontari quando un contenuto è pronto per essere distribuito
- Calendario editoriale semplice: pianifica quando un contenuto deve essere generato e pubblicato
- Integrazione con piattaforme di raccolta fondi per inserire automaticamente link e widget nei contenuti generati
- Modalità offline: generazione con modello locale quando la connessione è instabile
- Accesso gratuito o fortemente scontato come programma dedicato

### Implicazioni di sviluppo

La modalità semplificata richiede un secondo flusso UX con decisioni automatiche che oggi sono esplicite. Il sistema di libreria di contenuti riutilizzabili è una forma di memoria dell'istanza: andy deve poter iniettare nel prompt informazioni persistenti legate all'organizzazione senza che l'utente le riscrivo ogni volta. Questo anticipa un sistema di "contesto organizzazione" che è trasversale a più verticali.

---

## 5. Verticale: Piccola Impresa — SaaS diretto

### Contesto

Il titolare di una piccola impresa non sa cosa sia un LLM e non vuole saperlo. Ha bisogno di una landing page per la propria pizzeria, di un volantino per l'offerta del weekend, di una pagina per il proprio evento. Andy deve essere per lui uno strumento semplice come Canva ma con l'output che lui vuole davvero: una pagina web funzionante, non un template da completare.

### Funzionalità ad alto livello

**Onboarding per settore**
Al primo accesso, andy chiede: che tipo di attività hai? In tre click (ristorante, negozio, servizio, altro) configura un profilo che orienta tutte le generazioni successive. La pizzeria ottiene output con menù, orari, mappa e atmosfera. Il parrucchiere ottiene output con servizi, prenotazione e galleria. Il settore è il layer di pre-prompting più importante per questa verticale.

**Generazione da prompt vocale o fotografico**
La piccola impresa non sempre ha facilità con la scrittura. Andy dovrebbe accettare l'input in forme diverse: una foto del menu scritto a mano, una foto della vetrina, un messaggio vocale che descrive l'offerta del giorno. L'input multimodale abbassa la barriera d'accesso in modo decisivo.

**Pubblicazione con dominio personalizzato**
Il titolare vuole che la sua pagina sia su "pizzeria-daluigi.it", non su un sottodominio di andy. La gestione del dominio personalizzato, anche solo tramite redirect o CNAME, è una feature di valore percepito alto per questo segmento.

**QR code generato automaticamente**
Ogni pagina pubblicata genera automaticamente un QR code scaricabile e pronto per la stampa. Il QR è il punto di contatto fisico-digitale che la piccola impresa capisce e usa.

**Aggiornamento rapido dei contenuti**
La pizzeria cambia il menu ogni settimana. Andy deve permettere l'aggiornamento rapido di elementi specifici (il menu, le offerte, gli orari) senza rigenerare tutto. Una modalità di editing guidato per i contenuti variabili è più utile della rigenerazione completa.

### Funzionalità a medio livello

- Notifica quando una pagina pubblicata viene visitata (analytics minimo)
- Suggerimento proattivo: "È venerdì, vuoi aggiornare le offerte del weekend?"
- Integrazione con Google Business Profile per importare automaticamente orari e informazioni
- Modalità stagionale: template e tono cambiano automaticamente in base al periodo dell'anno
- Piano gratuito con limite di generazioni, piano a pagamento senza limiti e con dominio personalizzato
- Supporto WhatsApp o chat per utenti non a proprio agio con l'interfaccia web

### Implicazioni di sviluppo

L'input multimodale (foto, voce) richiede un preprocessing prima dell'LLM: OCR per immagini, speech-to-text per audio, poi trasformazione in prompt strutturato. Il sistema di aggiornamento rapido richiede che l'output generato abbia una struttura semantica che andy conosce e può modificare in modo puntuale, non solo come testo grezzo. Il QR code è una feature relativamente semplice ma di alto impatto percepito: andrebbe implementata presto e resa visibile.

---

## 6. Verticale: Venditori di Spazi Pubblicitari

### Contesto

Un editore locale, una concessionaria pubblicitaria o una rete di affissioni vende spazi. Il contenuto da mostrare in quegli spazi — la landing page, il mini sito, la locandina digitale — è oggi un problema del cliente. Andy permette all'editore di offrire il contenuto come parte del pacchetto pubblicitario, aumentando il valore percepito dell'offerta senza aumentare proporzionalmente i costi.

### Funzionalità ad alto livello

**White label completo**
Andy sparisce completamente. L'interfaccia, il dominio, la comunicazione sono del venditore. Il cliente finale non sa che esiste andy. Il white label non è solo cosmesi: include la possibilità di personalizzare il flusso, le opzioni disponibili, i formati offerti.

**Pacchetti di formato**
Il venditore definisce cosa può essere generato: solo landing page? Solo locandine digitali? Solo mini siti one-scroll? L'utente vede solo le opzioni incluse nel proprio pacchetto commerciale. La configurazione dei pacchetti avviene nel pannello del venditore, non in quello dell'utente.

**Pubblicazione su dominio dell'editore**
I contenuti generati dai clienti vengono pubblicati su un sottodominio dell'editore (cliente1.editore.it), non su un dominio andy. Questo mantiene il traffico nell'ecosistema dell'editore e rafforza il valore della relazione.

**Gestione scadenze**
Un pacchetto pubblicitario ha una durata. La landing page generata dovrebbe scadere insieme alla campagna. Andy gestisce le scadenze di pubblicazione: notifica il cliente in anticipo, offre il rinnovo, archivia il contenuto alla scadenza.

**Reportistica per il venditore**
Quante landing sono state generate? Quante sono attive? Quante visite hanno ricevuto? Il venditore ha bisogno di questi dati per valorizzare il servizio ai propri clienti e per il rinnovo.

### Funzionalità a medio livello

- Template di onboarding per il cliente del venditore (non per il venditore stesso)
- Integrazione con il CRM del venditore per importare automaticamente i dati del cliente nell'output
- Email automatica al cliente con link alla propria landing e QR code allegato
- Limite di modifiche post-generazione per piano commerciale
- Watermark opzionale sull'output (es. "realizzato con [nome editore]")

### Implicazioni di sviluppo

Questa verticale richiede una gerarchia a tre livelli: andy come piattaforma, il venditore come operatore, il cliente finale come utente. Il white label richiede una personalizzazione dell'interfaccia a livello di theme e di copy, non solo di logo. La gestione delle scadenze richiede un sistema di scheduling e notifiche. L'integrazione con CRM esterni è un punto di complessità significativo ma ad alto valore.

---

## 7. Verticale: Eventi & Fiere — Postazioni Fisiche

### Contesto

Una postazione fisica in fiera è un oggetto ibrido: è uno schermo, ma è anche un'esperienza. Le persone si avvicinano, interagiscono, portano via qualcosa. Andy come "content machine" in fiera genera valore esperienziale, non solo funzionale: il visitatore ha partecipato alla creazione di qualcosa, non solo ricevuto materiale promozionale.

### Funzionalità ad alto livello

**Modalità kiosk**
Un'interfaccia ridotta e touch-friendly, pensata per schermi in posizione verticale o orizzontale, operati da persone che non conoscono andy. Input semplice, output rapido, nessun dettaglio tecnico. La modalità kiosk disabilita tutto ciò che non serve all'esperienza: account, impostazioni, storico.

**Brand lock**
Il brand dell'evento o dello sponsor è immutabile. Logo, colori, claim, font sono iniettati nel layer obbligatorio e non possono essere rimossi o modificati dall'utente. Il visitatore ha libertà creativa nel contenuto ma non nell'identità visiva. Il brand lock è una garanzia contrattuale che andy deve poter offrire.

**Generazione rapida**
In fiera il tempo di attesa è un vincolo critico. La generazione deve essere ottimizzata per velocità: modelli più piccoli e veloci, output semplificati, pre-generazione di elementi comuni. L'utente vede il risultato in 10-15 secondi, non in 60.

**Export immediato**
Il visitatore vuole portare via il suo contenuto. QR code generato all'istante per scaricarlo sul proprio telefono, email diretta, o download immediato su chiavetta. Più opzioni, meno attriti.

**Sessioni anonime**
In fiera non si vuole registrare nessuno. Le sessioni sono anonime, senza account. I contenuti generati sono temporanei lato server o scaricati immediatamente. La privacy è una feature, non un vincolo.

### Funzionalità a medio livello

- Contatore di generazioni in tempo reale visibile sull'interfaccia (engagement gamification)
- Galleria pubblica live: gli output generati durante l'evento appaiono su uno schermo separato
- Moderazione automatica prima della pubblicazione in galleria
- Report post-evento: quante generazioni, che formati, che temi più richiesti
- Configurazione remota della postazione (cambio brand kit, aggiornamento tema) senza intervento fisico
- Modalità demo pre-caricata per quando la connessione è instabile

### Implicazioni di sviluppo

La modalità kiosk è un entry point completamente diverso dall'applicazione standard, con requisiti di UX (touch, schermo grande, input semplificato) e di sistema (sessioni anonime, nessun account, generazione rapida) molto distanti dal caso d'uso normale. Il brand lock richiede che certi elementi del layer siano contrassegnati come non modificabili a livello di sistema, non solo di interfaccia. La galleria live richiede un canale real-time tra le generazioni e il display.

---

## 8. Verticale: Gaming & Community

### Contesto

Andy può generare casual game HTML funzionanti. Questo è un caso d'uso che non ha equivalenti diretti nel mercato degli strumenti no-code: la generazione di esperienze interattive, non solo di contenuti passivi. La verticale gaming è ancora da esplorare ma ha un potenziale di differenziazione molto alto.

### Funzionalità ad alto livello

**Generi di gioco pre-configurati**
La generazione di un gioco partendo da zero richiede un prompt molto ricco. Andy può offrire generi pre-configurati — runner, quiz, puzzle, memory, clicker — che definiscono le meccaniche di base e lasciano all'utente la personalizzazione di tema, personaggi e narrativa. Il genere è il layer di struttura, il prompt è il layer di contenuto.

**Bilanciamento assistito**
Un gioco funzionante ma impossibile o banale non è un buon gioco. Andy dovrebbe applicare automaticamente vincoli di bilanciamento basati sul genere: velocità di progressione, frequenza degli ostacoli, curva di difficoltà. Questi parametri non sono visibili all'utente ma sono parte del layer di generazione.

**Asset brandizzati obbligatori**
Per la verticale eventi e fiere, i personaggi, gli sfondi e gli elementi grafici del gioco possono essere pre-definiti dall'organizzatore. Il visitatore personalizza la storia o il nome del personaggio, ma gioca sempre con l'identità visiva dell'evento.

**Leaderboard integrata**
Un gioco senza competizione perde metà del suo valore. Andy dovrebbe poter generare output che includono una leaderboard, condivisa tra tutti i fruitori dello stesso gioco. La leaderboard è un servizio, non un file statico: richiede un backend minimo o un'integrazione con un servizio esterno.

**Export per streaming e social**
I content creator vogliono mostrare i propri giochi. Export in formato ottimizzato per OBS (overlay trasparente), screenshot automatico dello schermo di gioco, clip breve del gameplay per i social.

### Funzionalità a medio livello

- Editor di parametri di gioco: velocità, difficoltà, durata — senza toccare il codice
- Anteprima rapida del gameplay prima dell'export
- Modalità multiplayer locale (stesso schermo, due input) per contesti evento
- Integrazione con piattaforme di gaming community (itch.io, Newgrounds) per pubblicazione diretta
- Generazione di varianti: stesso gioco, tema diverso, per campagne stagionali

### Implicazioni di sviluppo

Il casual game è il tipo di output più complesso che andy può generare: richiede logica di gioco funzionante, non solo contenuto visivo. Il pre-prompting per i generi deve essere molto più strutturato e testato rispetto agli altri formati. Il bilanciamento assistito richiede una conoscenza del dominio gaming che deve essere codificata nel layer, non lasciata all'LLM. La leaderboard rompe il paradigma self-contained: è il primo caso in cui l'output ha bisogno di un servizio esterno per funzionare completamente.

---

## 9. Verticale: Developer & Open Source

### Contesto

I developer sono i primi utenti di andy e i suoi primi contributori. Usano andy in modo diverso da tutti gli altri: lo integrano, lo forkano, lo estendono, lo rompono consapevolmente. Il loro valore non è nelle generazioni che producono ma nella direzione che danno al progetto.

### Funzionalità ad alto livello

**API-first come modalità di accesso principale**
Ogni funzionalità di andy deve essere accessibile via API REST prima ancora che via interfaccia. Il developer non usa la UI, usa l'API. La UI è un client dell'API, non il contrario. Questa inversione di prospettiva ha implicazioni architetturali profonde.

**Sistema di plugin per il layer di pre-prompting**
Il developer vuole iniettare il proprio contesto nel sistema di generazione. Un sistema di plugin permette di aggiungere layer personalizzati senza modificare il core. Il plugin può essere un file di configurazione, uno script, o un endpoint esterno che andy chiama durante la fase di pre-prompting.

**Modalità debug del pre-prompting**
Il developer vuole vedere esattamente cosa viene inviato all'LLM. Una modalità debug mostra il prompt completo, inclusi tutti i layer, prima e dopo l'ottimizzazione. Questo non è visibile all'utente normale ma è essenziale per chi sviluppa layer personalizzati.

**Webhook per eventi di generazione**
Ogni generazione completata può notificare un endpoint esterno: output pronto, link di download, metadati. Il developer può integrare andy in pipeline CI/CD, sistemi di pubblicazione automatica, o flussi di content operation.

**Containerizzazione e deploy semplificato**
Andy deve essere semplice da deployare in ambienti diversi: Docker, VPS, Raspberry Pi, server interno aziendale. La configurazione deve essere minima e documentata. Il developer che vuole un'istanza privata non deve combattere con l'infrastruttura.

### Funzionalità a medio livello

- CLI per generazione da terminale, senza UI
- SDK in almeno un linguaggio comune (Python o JavaScript) per integrazioni
- Documentazione API interattiva (OpenAPI/Swagger) generata automaticamente
- Sistema di test dell'output: verifica automatica che il file generato sia valido HTML, JS, CSS
- Changelog delle modifiche al sistema di pre-prompting tra versioni
- Ambiente di staging separato per testare nuovi layer senza impattare la produzione

### Implicazioni di sviluppo

L'API-first richiede che l'intera logica applicativa sia disaccoppiata dall'interfaccia. Se oggi la UI e il backend sono accoppiati, questa è la direzione in cui separarli. Il sistema di plugin è la feature di sviluppo più complessa ma anche quella con il maggiore impatto sulla community: permette a chiunque di contribuire nuove verticali senza modificare il core. I webhook richiedono un sistema di gestione degli eventi asincroni. La CLI è relativamente semplice ma ha un alto valore simbolico per la community open source.

---

## 10. Layer trasversali

### 10.1 Il sistema di contesto organizzazione

Trasversale a più verticali, la necessità di una memoria persistente dell'istanza emerge chiaramente. L'agenzia che non vuole riscrivere il brand del cliente, la pizzeria che non vuole reinserire il menu ogni volta, la scuola che vuole vincolare i prompt degli studenti: tutti hanno bisogno di un sistema che conosca "chi sono" e "come lavoro" senza che l'utente lo debba ridire ogni volta.

Il contesto organizzazione è un layer di informazioni persistenti, gestito dall'amministratore dell'istanza, che viene automaticamente incluso in ogni generazione. Non è un template, è un insieme di fatti e vincoli che andy conosce sempre.

### 10.2 Il sistema di moderazione

Qualunque verticale che preveda output pubblici — la bacheca scolastica, la galleria dell'evento, la landing del cliente dell'agenzia — ha bisogno di un sistema di moderazione. La moderazione può essere:

- Manuale: un amministratore approva ogni output prima della pubblicazione
- Semi-automatica: un filtro automatico blocca contenuti problematici, il resto passa
- Automatica: nessun intervento umano, solo filtri

Il sistema di moderazione deve essere configurabile per verticale, non hardcoded. Ciò che è accettabile in un contesto di fiera non lo è in uno scolastico.

### 10.3 Il sistema di analytics

Andy non sa cosa succede dopo la pubblicazione. Quante persone vedono la landing generata? Per quanto tempo? Da dove arrivano? Questi dati sono preziosi per tutte le verticali, specialmente per l'agenzia e per il venditore di spazi. Un sistema di analytics minimale — contatore di visite, provenienza, tempo di sessione — integrato direttamente nell'output generato aggiungerebbe valore significativo senza complicare il modello self-contained.

### 10.4 Il sistema di assets ricorrenti

Logo, font, immagini di prodotto, foto dello staff: questi asset si ripetono in ogni generazione per lo stesso cliente. Un sistema di libreria assets associata al profilo o al tenant permette di:

- Iniettare automaticamente gli asset rilevanti nel prompt di generazione
- Includere gli asset fisici nell'output ZIP senza che l'utente li debba caricare ogni volta
- Gestire i diritti di uso degli asset (quali sono disponibili per quali generazioni)

---

## 11. Roadmap per priorità

### Immediato — Fondamenta per tutte le verticali

- Sistema di layer di pre-prompting componibili e configurabili
- Multi-tenancy base (separazione utenti e output per organizzazione)
- Contesto organizzazione persistente
- API REST completa con documentazione

### Breve termine — Verticali P1

- Brand kit per cliente (per agenzia)
- Onboarding per settore (per piccola impresa)
- Profilo privacy-first con modelli locali obbligatori (per scuola)
- QR code automatico su ogni output pubblicato
- Export PDF e immagine da HTML

### Medio termine — Verticali P2 e feature avanzate

- White label completo (per venditore spazi)
- Modalità kiosk touch-friendly (per eventi)
- Modalità laboratorio con percorsi strutturati (per scuola)
- Sistema di moderazione configurabile
- Workflow di approvazione output
- Webhook per eventi di generazione

### Lungo termine — Verticali P3 e differenziatori

- Generi di gioco pre-configurati (per gaming)
- Sistema di plugin per layer personalizzati (per developer)
- Leaderboard come servizio per output gaming
- Input multimodale: foto e voce (per piccola impresa)
- Analytics integrato negli output pubblicati
- CLI e SDK

---

> *Questo documento è un punto di partenza, non una specifica. Le direzioni qui descritte sono orientamenti strategici: ogni funzionalità andrà validata con utenti reali prima di essere sviluppata. La priorità reale emerge dall'uso, non dalla pianificazione.*
