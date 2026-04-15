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
- Logo: text `Andy Code Cat` with a small lightning-bolt icon (inline SVG)
- Nav links: Features · How it works · Pricing · Docs (anchor links with smooth scroll)
- CTA button: `Start free →` (links to `/login`)
- Mobile: hamburger menu that toggles a slide-down panel (`"use client"`)

### 2. `<Hero>` — Above the fold
- Headline (H1): **"From prompt to live site in minutes."** (bold, large, gradient text)
- Sub-headline: "Andy Code Cat turns your idea into a professional landing page with AI. No coding. No bottlenecks. Just momentum."
- Two CTAs: primary `Create your site →` → `/login`; secondary `Watch the demo ↓` → `#how-it-works`
- Visual: a mock browser window (pure CSS/divs) showing a generated site with a blinking cursor to suggest the AI is building in real time
- Background: dark gradient (`from-slate-950 via-slate-900 to-slate-800`) with a subtle grid or noise texture in CSS

### 3. `<LogoBar>` — Social proof strip
- Label: "Built for teams worldwide — powered by open standards"
- Show 5–6 muted inline SVG tech logos (React, Next.js, Node.js, MongoDB, Redis, nginx)
- Purpose: reinforce technical credibility without implying endorsement

### 4. `<Features>` — id="features"
Three-column card grid (stacked on mobile). Each card needs an icon, a title, and 2–3 lines of copy.

| Icon | Title | Copy |
|---|---|---|
| ✦ AI | Generate from a prompt | Describe your idea in plain language. Andy Code Cat turns it into production-ready HTML, CSS, and JavaScript in seconds. |
| 💬 Chat | Refine through conversation | Improve the result through a live chat workflow with real-time preview. No reloads, no lost context. |
| 🚀 Publish | Go live in one click | Launch under a dedicated subdomain with automatic HTTPS. No server setup required. |
| 📦 Export | Take it anywhere | Download the complete ZIP package and deploy it to any hosting provider. No vendor lock-in. |
| 🔌 API-first | Integrate your platform | A documented REST API makes it easy for agencies or SaaS products to plug in their own UI. |
| 🔒 Security | Safe sandboxes | Each project is isolated per user with double-sandbox enforcement. Your data stays yours. |

### 5. `<HowItWorks>` — id="how-it-works"
Numbered step-by-step section (3 large steps):

1. **Describe your idea** — write a short prompt such as "landing page for my pizza shop with online booking" or paste an existing brief.
2. **The AI builds the site** — Andy Code Cat analyzes the input, chooses structure and tone, and generates the code while the preview updates live.
3. **Publish or export** — launch instantly on your subdomain or download a ZIP bundle and deploy it wherever you want.

Each step should have a large number, title, description, and a simple illustration (pure CSS diagram or inline SVG).

### 6. `<SocialProof>` — Testimonials
Three testimonial cards with initials avatars, name, role, and quote:

- **"Marco R." — Freelance Developer** — "I had a client landing page ready in 10 minutes. It was approved almost instantly. I save hours every week."
- **"Sara M." — Marketing Manager** — "I no longer wait on engineering for the first draft. I write the idea, Andy Code Cat builds it, and I refine it. Total game changer."
- **"Luca B." — Founder, Startup** — "I tested five product ideas in a single afternoon using real landing pages instead of mockups. Much faster learning loop."

### 7. `<Pricing>` — id="pricing"
Three pricing tiers displayed as cards, with the middle tier highlighted as the most popular.

| Plan | Price | Features |
|---|---|---|
| **Starter** free | €0/month | 50 starter credits · 3 projects · ZIP export · Community support |
| **Pro** ⭐ most popular | €19/month | 500 credits/month · Unlimited projects · Managed subdomain publishing · Priority support · API access |
| **Agency** | €79/month | Unlimited credits · White-label options · Full REST API · Multi-client management · SLA |

Each card: plan name, price, feature list with checkmarks, and CTA button (`Start` / `Choose Pro` / `Contact us`).

Note: include a small muted disclaimer saying "Pricing is indicative. The platform is currently in beta." below the cards.

### 8. `<FAQ>` — Accordion (optional island)
Five questions, collapsed by default (`"use client"` accordion island):

1. Do I need technical skills to use Andy Code Cat?
2. Do I fully own the generated website?
3. Which AI models can be used?
4. Can I connect a custom domain?
5. How do credits work?

### 9. `<CtaBanner>` — Final CTA
- Headline: "Ready to build something real?"
- Copy: "Start for free today. No credit card required."
- CTA button: `Create your free site →` → `/login`
- Background: dark with a subtle gradient or animated CSS glow

### 10. `<Footer>`
- Logo + tagline: `Andy Code Cat — AI-powered web generation`
- Nav columns: Product (Features, How it works, Pricing), Developers (API Docs, Export, Integrations), Legal (Privacy Policy, Terms of Service)
- Social: GitHub icon (link to `#`)
- Copyright: `© 2026 Andy Code Cat. All rights reserved.`

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
