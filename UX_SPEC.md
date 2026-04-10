# Andy Code Cat — UX Flow Completo

> **Principio guida:** ogni schermata ha un solo obiettivo. L'utente non deve mai chiedersi "cosa faccio adesso?".  
> **Tono:** silenzioso, automatico, rassicurante. La piattaforma lavora in background.

---

## Mappa Schermate

```
/                          Landing pubblica
/login                     Login / Register
/onboarding                Wizard primo accesso (GDPR, profilo)
/dashboard                 Lista progetti utente
/projects/new              Wizard creazione progetto (6 step)
/projects/:id              Workspace progetto (generazione + preview)
/projects/:id/publish      Wizard pubblicazione
/projects/:id/settings     Impostazioni progetto (dominio, collaboratori)
/profile                   Profilo utente, crediti, abbonamento
/billing                   Acquisto crediti / piani
/sites/:slug/_pf_auth      Pagina login custom per siti protetti
```

---

## UX-01 — Registrazione e Onboarding

### Login `/login`
- SSO Google / GitHub (OAuth2)
- Email + password nativa con verifica magic link (valido 24h)
- Primo accesso → `/onboarding`; accesso successivo → `/dashboard`

### Onboarding `/onboarding`
Una singola schermata, 3 blocchi:

**Blocco A — Profilo (opzionale, saltabile)**
```
Come ti chiami? [Nome] [Cognome]
Per cosa userai Andy Code Cat?
  ○ Per me / la mia attività
  ○ Per i miei clienti (agenzia/freelance)
  ○ Per testare idee
```

**Blocco B — Consensi GDPR (obbligatorio)**
```
☑ Accetto i Termini di Servizio e la Privacy Policy
☐ Acconsento a comunicazioni marketing (opzionale)
☐ Acconsento all'uso dati per migliorare il servizio (opzionale)
```

**Blocco C — Cookie banner inline**
```
[Solo necessari]  [Accetta tutti]
```

CTA: "Inizia a creare →" → 50 crediti gratuiti aggiunti → `/dashboard`

---

## UX-02 — Dashboard `/dashboard`

```
┌──────────────────────────────────────────────────────┐
│  Andy Code Cat      [+ Nuovo progetto]        👤 Massi   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │ 🟢 LIVE      │ │ ⚙️ Generando │ │      +      │  │
│  │ SpeedRank    │ │ PayFlow      │ │   Nuovo     │  │
│  │ ↗ Visita    │ │ ⏳ 2 min...  │ │  progetto   │  │
│  └──────────────┘ └──────────────┘ └─────────────┘  │
│                                                      │
│  Crediti: 34 / 50   [Ricarica]                       │
└──────────────────────────────────────────────────────┘
```

- Card stato: draft / generating / generated / live / error
- Barra crediti persistente
- Progetti in generazione: spinner animato, non richiedono attenzione

---

## UX-03 — Wizard Creazione `/projects/new`

**Filosofia:** conversazionale. Step precedenti collassano mostrando il riassunto.

### Step 1 — Input idea
```
  Descrivi la tua idea 💬
  ┌────────────────────────────────────────────┐
  │ Es. "Landing page per la mia pizzeria..."  │
  └────────────────────────────────────────────┘
  min 20 char                      [Avanti →]
```

### Step 2 — Stile visivo
- 10 temi predefiniti con preview PNG (300×200)
- Filtri: Minimal / Bold / Elegante / Playful / Dark / Corporate
- Selezione opzionale ("Salta" disponibile)

**Libreria temi MVP:**

| ID | Nome | Palette | Font |
|---|---|---|---|
| minimal-white | Alba | Bianco/Slate | Inter |
| bold-dark | Midnight | Nero/Gold | Space Grotesk |
| elegant-serif | Cartier | Crema/Bordeaux | Playfair Display |
| playful-color | Confetti | Pastelli | Nunito |
| dark-tech | Matrix | Nero/Verde neon | JetBrains Mono |
| corporate-blue | Atlantic | Blu navy/Bianco | DM Sans |
| warm-startup | Terracotta | Arancio/Sabbia | Plus Jakarta Sans |
| clean-saas | Vercel | Bianco/Nero/Viola | Geist |
| nature-green | Foresta | Verde/Beige | Lora |
| luxury-gold | Aurum | Nero/Oro | Cormorant |

### Step 3 — Documento allegato
- Upload drag-and-drop: PDF, DOC, DOCX, TXT, MD
- Max 10MB, 1 file per MVP
- Opzionale ("Salta" disponibile)

### Step 4 — Foto
- Upload multiplo: max 6 immagini JPG/PNG/WebP, 5MB cad.
- Thumbnail preview immediata
- Nota GDPR sull'uso delle immagini

### Step 5 — Brief generato (auto, ~2-3s di wait)

Il brief viene elaborato **in background durante gli step 1-4** con una chiamata LLM leggera (Haiku/Flash).

```
┌───────────────────────────────────────────────────┐
│ ✨ Ho elaborato la tua idea                        │
│                                                   │
│ 🍕 Landing page — Pizzeria Napoletana             │
│                                                   │
│ **Obiettivo:** Presentare la pizzeria, mostrare   │
│ il menu e raccogliere prenotazioni.               │
│                                                   │
│ **Sezioni:**                                      │
│ • Hero con foto e claim principale                │
│ • Menu (dal PDF allegato)                         │
│ • Galleria foto                                   │
│ • Form prenotazione                               │
│ • Footer con mappa e contatti                     │
│                                                   │
│ **Stile:** Bold Dark · **Lingua:** Italiano       │
└───────────────────────────────────────────────────┘

Vuoi correggere o affinare?
┌────────────────────────────────────────────────┐
│ Es. "aggiungi sezione testimonials..."         │
└────────────────────────────────────────────────┘

Costo stimato: ~8 crediti   Disponibili: 34

        [← Modifica]   [🚀 Avvia generazione]
```

- Se crediti insufficienti: bottone disabilitato + link ricarica
- Stima crediti: `base(5) + pdf(2) + images(n×0.5) + loops(n×1.5)`

---

## UX-04 — Workspace Progetto `/projects/:id`

### Durante la generazione

```
⚙️ Sto creando il tuo sito...

████████████████░░░░  65%

✅ Brief elaborato
✅ Struttura progetto creata
✅ HTML e CSS generati
⏳ Generazione immagini... (2/4)
○  Verifica qualità automatica
○  Ottimizzazione finale

[Log dettagliato ▼]  (collassato di default)

Crediti consumati: 4/8 stimati
```

- Aggiornamento real-time via SSE
- Log collassato per default, espandibile
- L'utente può chiudere la tab e tornare: stato persistito

### Verifica automatica (post-generazione)

```
✅ Sito generato
✅ Immagini elaborate
⏳ Verifica qualità... (iterazione 1/3 — configurabile)
   → Analisi HTML con Playwright
   → Verifica corrispondenza contenuti con LLM
   → Correzione automatica se necessario
```

Il numero di iterazioni massimo è configurabile per progetto (default: 3).

### Sito pronto

```
┌────────────────────────────────────────────────────┐
│ ✅ Il tuo sito è pronto!                           │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │                                              │  │
│  │          [IFRAME PREVIEW]                   │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│  [📱 Mobile]  [💻 Desktop]   [↗ Apri in nuova tab] │
│                                                    │
│  ┌─────────────────┬──────────────────────────┐    │
│  │ 💬 Modifica     │ 🌐 Pubblica online        │    │
│  └─────────────────┴──────────────────────────┘    │
│                                                    │
│  Crediti usati: 7   Rimanenti: 27                  │
└────────────────────────────────────────────────────┘
```

---

## UX-05 — Modifica / Raffinamento

Panel laterale o modale:

```
Cosa vuoi cambiare?
┌──────────────────────────────────────────────────┐
│ Es. "Cambia il colore in rosso, aggiungi prezzi" │
└──────────────────────────────────────────────────┘

Costo stimato: ~3 crediti
Iterazioni manuali rimanenti: 2 (max: 3)

              [Annulla]   [Applica modifica]
```

Se iterazioni manuali esaurite:
> "Hai raggiunto il limite di modifiche. Pubblica il sito e continua a editare i file direttamente, oppure avvia un nuovo progetto."

---

## UX-06 — Wizard Pubblicazione `/projects/:id/publish`

### Step 1 — Nome del sito

```
Nome attuale (temporaneo, solo per te):
  velvet-phoenix-42.Andy Code Cat.io

Scegli il tuo indirizzo:
┌──────────────────────────┐
│ pizzeria-napoli          │.Andy Code Cat.io
└──────────────────────────┘
✅ Disponibile!

Oppure usa un tuo dominio:
┌──────────────────────────┐
│ www.pizzerianapoli.it    │
└──────────────────────────┘
ℹ️ Ti guideremo nella configurazione DNS.
```

- Nome temporaneo generato: `{aggettivo}-{animale}-{numero}` (es. `velvet-phoenix-42`)
- Validazione real-time univocità (tutti i progetti di tutti gli utenti)
- Solo lowercase, numeri, trattini; min 3, max 63 char

### Step 2 — Visibilità

```
○ 🌍 Pubblico
   Chiunque con il link può vederlo. Indicizzato.

● 🔒 Protetto da password
   ┌────────────────────────────┐
   │ Scegli una password        │
   └────────────────────────────┘
   Pagina di accesso branded Andy Code Cat.
   Cookie sessione 7 giorni per i visitatori.

○ 👁 Privato (solo tu)
   Visibile solo se loggato su Andy Code Cat.
   Non indicizzato.
```

### Step 3 — Pubblicazione in corso

```
✅ File copiati in webroot
✅ Nginx configurato
✅ SSL Let's Encrypt attivato
✅ Sito online!

🎉 https://pizzeria-napoli.Andy Code Cat.io

[↗ Visita]   [📋 Copia link]   [Dashboard]

📧 Recap inviato via email.
```

**Email di recap automatica:**
- URL del sito pubblicato
- Crediti usati / rimanenti
- Link a: gestione progetto, export ZIP, guida DNS dominio custom
- Allegato PDF: guida rapida personalizzata per il progetto

---

## UX-07 — Crediti Esauriti

```
⚠️ Crediti esauriti

La generazione è in pausa. Il progetto è salvato.

Crediti rimanenti: 0
Crediti necessari: ~3

[20 crediti — €2,99]
[100 crediti — €9,99]  ← Consigliato
[Piano Pro — €19/mese — crediti illimitati]

[Vedi cosa è stato generato finora]
```

- Sessione salvata in MongoDB (`status: 'paused_credits'`)
- File parziali preservati in git branch
- Alla ricarica: generazione riprende dal punto di interruzione automaticamente

---

## UX-08 — Dominio Personalizzato

Da `/projects/:id/settings` → tab "Dominio":

```
Dominio attuale: pizzeria-napoli.Andy Code Cat.io

Dominio personalizzato:
┌─────────────────────────────┐
│ www.pizzerianapoli.it       │
└─────────────────────────────┘

Configura il DNS del tuo dominio:

  Tipo    Nome    Valore
  A       @       185.xxx.xxx.xxx
  A       www     185.xxx.xxx.xxx

ℹ️ La propagazione DNS può richiedere 1-48 ore.

[Verifica configurazione DNS]
Status: ⏳ In attesa di propagazione

Quando il DNS sarà attivo, SSL verrà
configurato automaticamente (Let's Encrypt).
```

---

## UX-09 — Collaborazione

Da `/projects/:id/settings` → tab "Condivisione":

```
Invita collaboratori:
┌───────────────────────────┐  [Invita]
│ email@esempio.com         │
└───────────────────────────┘

Collaboratori:
👤 marco@studio.it    [Può modificare ●]  [✕]
👤 sara@cliente.com   [Solo lettura    ○]  [✕]

Link preview condivisibile (senza login):
[Abilita link pubblico]
https://Andy Code Cat.io/preview/abc123xyz
```

---

## UX-10 — Sito Protetto da Password

Pagina servita da Andy Code Cat prima di mostrare il sito:

```
┌─────────────────────────────────────┐
│                                     │
│              🔒                     │
│   pizzeria-napoli.Andy Code Cat.io      │
│                                     │
│   Sito protetto da password         │
│   ┌─────────────────────────────┐   │
│   │ Inserisci la password       │   │
│   └─────────────────────────────┘   │
│                  [Accedi]           │
│                                     │
│   ──────────────────────────────   │
│   Powered by Andy Code Cat              │
│   [Crea il tuo sito gratis →]       │
│                                     │
└─────────────────────────────────────┘
```

- Gestita da nginx: `location = /_pf_auth` intercetta prima dei file statici
- Cookie `pf_site_auth_{slug}` JWT, 7 giorni
- Password hashata bcrypt in MongoDB
