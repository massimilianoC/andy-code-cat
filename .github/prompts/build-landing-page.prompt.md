---
mode: agent
description: Build the commercial marketing landing page for Andy Code Cat
tools:
  - file_search
  - grep_search
  - read_file
  - create_file
  - replace_string_in_file
  - multi_replace_string_in_file
  - run_in_terminal
  - get_errors
---

# Agent Task: Build the Andy Code Cat Commercial Marketing Landing Page

## Mission

Create a complete, production-ready **commercial marketing landing page** for **Andy Code Cat** — an AI-powered platform that generates landing pages and mini-sites from natural language prompts.

The page must be implemented inside the existing Next.js app at `apps/web/` and accessible at the root route `/`.

---

## Product Context

**Andy Code Cat** is a SaaS platform that turns a text description into a fully-built, published website in minutes. Key capabilities:

- **AI-powered generation** — describe your idea in plain text; Andy Code Cat generates HTML/CSS/JS automatically via LLM
- **Chat-based iterative editing** — refine the result through a conversational interface with real-time streaming preview
- **Multi-provider LLM** — pluggable AI backends (OpenRouter, SiliconFlow, LM Studio and more)
- **One-click publish** — site goes live on a dedicated subdomain with automatic HTTPS/SSL via Let's Encrypt
- **ZIP export** — download the complete site bundle ready for any hosting
- **Project management dashboard** — manage multiple sites, track generation status, monitor credits
- **Double sandbox security** — every project is fully isolated per user
- **API-first architecture** — third parties can integrate via REST API and point their own nginx reverse proxy

**Target audience:** freelancers, marketing agencies, indie makers, startup founders, non-technical entrepreneurs.

**Tone:** modern, confident, direct. The platform is silent and automatic — it works so the user doesn't have to.

---

## Technical Constraints

- Framework: **Next.js 15 App Router** (TypeScript, already configured)
- Styling: **Tailwind CSS** — check if already present in `apps/web/package.json`; if not, install it
- The landing page lives at `apps/web/app/page.tsx` (the root `/` route)
- Do **not** break existing routes (`/login`, `/dashboard`, `/projects/*`, etc.)
- Components go in `apps/web/components/landing/` (create the folder)
- Use only the dependencies already in `apps/web/package.json` or lightweight, well-known packages
- Images/assets: use inline SVGs, CSS gradients, or placeholder images from `https://placehold.co` — do not fetch from external CDNs at build time
- The page must be **fully responsive** (mobile-first)
- Keep the page as a **static Server Component** (no `"use client"` except for interactive islands like the CTA modal or mobile menu)

---

## Page Architecture

Build the landing page with the following sections **in order**:

### 1. `<Header>` — Sticky navigation
- Logo: text `Andy Code Cat` with a small lightning bolt icon (inline SVG)
- Nav links: Features · How it works · Pricing · Docs (anchor links, smooth scroll)
- CTA button: `Inizia gratis →` (links to `/login`)
- Mobile: hamburger toggling a slide-down menu (`"use client"`)

### 2. `<Hero>` — Above the fold
- Headline (H1): **"Dal prompt al sito in minuti."** (bold, large, gradient text)
- Sub-headline: "Andy Code Cat trasforma la tua idea in una landing page professionale usando l'intelligenza artificiale. Nessun codice. Nessun progettista. Solo risultati."
- Two CTAs: primary `Crea il tuo sito →` → `/login`; secondary `Guarda la demo ↓` → `#how-it-works` anchor
- Visual: a mock browser window (pure CSS/divs) showing a simulated generated site with a blinking cursor — conveys "AI is building it now"
- Background: dark gradient (`from-slate-950 via-slate-900 to-slate-800`) with subtle grid or noise texture via CSS

### 3. `<LogoBar>` — Social proof strip
- Label: "Usato da team in tutto il mondo — built on open standards"
- Show 5–6 tech logos as inline SVG icons (React, Next.js, Node.js, MongoDB, Redis, nginx) with a muted style
- Purpose: reinforce technical credibility, not specific brand endorsements

### 4. `<Features>` — id="features"
Three-column card grid (stacked on mobile). Each card has an icon, a title, and 2–3 lines of copy.

| Icon | Title | Copy |
|---|---|---|
| ✦ AI | Genera con un prompt | Descrivi la tua idea. Andy Code Cat la trasforma in HTML, CSS e JavaScript professionale in pochi secondi. |
| 💬 Chat | Itera in conversazione | Affina il risultato attraverso una chat live con anteprima in tempo reale. Nessun reload, nessuna perdita di contesto. |
| 🚀 Pubblica | Online in un click | Il tuo sito va live su un sottodominio dedicato con HTTPS automatico. Zero configurazioni server. |
| 📦 Export | Portalo ovunque | Scarica il pacchetto ZIP completo e distribuiscilo su qualsiasi hosting. Nessun vendor lock-in. |
| 🔌 API-first | Integra con la tua piattaforma | REST API documentata. Le agenzie possono usare Andy Code Cat come motore backend con la propria UI. |
| 🔒 Sicurezza | Sandbox sicuri | Ogni progetto è isolato per utente con doppio controllo sandbox. I tuoi dati restano tuoi. |

### 5. `<HowItWorks>` — id="how-it-works"
Numbered step-by-step section (3 big steps):

1. **Descrivi la tua idea** — Scrivi un testo libero (es. "landing page per la mia pizzeria con prenota-tavolo") o incolla il tuo documento.
2. **L'AI genera il sito** — Andy Code Cat analizza il tuo input, sceglie stile e struttura, e genera il codice completo. Vedi l'anteprima in diretta mentre il testo fluisce.
3. **Pubblica o scarica** — Con un click il sito va online sul tuo sottodominio. Oppure scarica il file ZIP e deployalo dove vuoi.

Each step: large number, title, description, a simple illustration (pure CSS diagram or inline SVG).

### 6. `<SocialProof>` — Testimonials
Three testimonial cards with avatar (initials circle), name, role, and quote:

- **"Marco R." — Freelance Developer** — "In 10 minuti avevo una landing page per il mio cliente. Il cliente l'ha approvata al volo. Risparmio ore ogni settimana."
- **"Sara M." — Marketing Manager** — "Non devo più aspettare il developer per la prima bozza. Scrivo l'idea, Andy Code Cat la costruisce, io la rifinisco. Game changer."
- **"Luca B." — Founder, Startup** — "Ho testato 5 idee di prodotto in un pomeriggio. Tutte con landing page reali, non mockup. Conversione reale dagli ad."

### 7. `<Pricing>` — id="pricing"
Three pricing tiers presented as cards (highlighted middle card for the popular plan):

| Plan | Price | Features |
|---|---|---|
| **Starter** gratis | €0/mese | 50 crediti iniziali · 3 progetti · Export ZIP · Community support |
| **Pro** ⭐ più popolare | €19/mese | 500 crediti/mese · Progetti illimitati · Pubblicazione sottodomini · Supporto prioritario · API access |
| **Agency** | €79/mese | Crediti illimitati · White-label · REST API full · Gestione clienti multi-account · SLA |

Each card: plan name, price, feature list with checkmarks, CTA button (`Inizia` / `Scegli Pro` / `Contatta`).

Note: add a small disclaimer "I prezzi sono indicativi. La piattaforma è in fase beta." in muted text below.

### 8. `<FAQ>` — Accordion (optional island)
Five questions, collapsed by default (`"use client"` accordion island):

1. Devo avere competenze tecniche per usare Andy Code Cat?
2. Il sito generato è davvero mio?
3. Che modelli AI vengono usati?
4. Posso usare un dominio personalizzato?
5. Come funzionano i crediti?

### 9. `<CtaBanner>` — Final CTA
- Headline: "Pronto a costruire qualcosa?"
- Copy: "Inizia gratis oggi. Nessuna carta di credito richiesta."
- CTA button: `Crea il tuo sito gratis →` → `/login`
- Background: dark with a subtle gradient or animated glow effect (CSS only)

### 10. `<Footer>`
- Logo + tagline: `Andy Code Cat — AI-powered web generation`
- Nav columns: Prodotto (Features, How it works, Pricing), Sviluppatori (API Docs, Export, Integrations), Legale (Privacy Policy, Termini di servizio)
- Social: GitHub icon (link to `#`)
- Copyright: `© 2026 Andy Code Cat. Tutti i diritti riservati.`

---

## Design System

Apply these Tailwind classes consistently:

- **Background:** `bg-slate-950` for dark sections, `bg-white` or `bg-slate-50` for light sections
- **Text:** `text-white` on dark, `text-slate-900` on light, `text-slate-500` for muted
- **Primary gradient (hero headline):** `bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent`
- **CTA primary button:** `bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-lg transition`
- **CTA secondary button:** `border border-slate-600 text-slate-300 hover:border-slate-400 px-6 py-3 rounded-lg transition`
- **Card:** `bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6`
- **Pricing popular card:** add `ring-2 ring-violet-500 scale-105` 
- **Section spacing:** `py-24 px-6` with `max-w-6xl mx-auto`
- **Font:** system font stack, or import `Inter` from `next/font/google` if not already present

---

## Implementation Steps

1. **Read** `apps/web/package.json` and `apps/web/app/page.tsx` to understand current state
2. **Check** if Tailwind CSS is configured; if not, set it up for Next.js 15 App Router
3. **Create** the folder `apps/web/components/landing/`
4. **Build** each section as a separate component file in that folder:
   - `Header.tsx`, `Hero.tsx`, `LogoBar.tsx`, `Features.tsx`, `HowItWorks.tsx`
   - `SocialProof.tsx`, `Pricing.tsx`, `Faq.tsx` (client), `CtaBanner.tsx`, `Footer.tsx`
5. **Replace** the contents of `apps/web/app/page.tsx` with the assembled landing page importing all components
6. **Verify** with `get_errors` that there are no TypeScript/lint errors
7. **Smoke test** by reading the assembled file and confirming all sections are present

---

## Quality Checklist

Before marking the task done, verify:

- [ ] All 10 sections are present in `page.tsx`
- [ ] No TypeScript errors in the landing components
- [ ] No `"use client"` on server components that don't need it
- [ ] All anchor `id` attributes match the nav links (`#features`, `#how-it-works`, `#pricing`)
- [ ] CTA buttons link to `/login` (not hardcoded external URLs)
- [ ] The page is self-contained and works without backend data (static)
- [ ] Mobile-responsive layout verified via Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)
- [ ] No secrets, no API keys, no hardcoded environment values in any component file
