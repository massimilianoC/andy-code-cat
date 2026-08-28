# Andy Code Cat — Complete UX Flow

> **Guiding principle:** each screen should have a single clear objective. The user should never wonder, “what do I do next?”  
> **Tone:** quiet, automatic, reassuring. The platform does the heavy lifting in the background.

---

## Screen Map

```
/                          Public landing page
/login                     Login / Register
/onboarding                First-access wizard (GDPR, profile)
/dashboard                 User's project list
/projects/new              Project creation wizard (6 steps)
/projects/:id              Project workspace (generation + preview)
/projects/:id/publish      Publish wizard
/projects/:id/settings     Project settings (domain, collaborators)
/profile                   User profile, credits, subscription
/billing                   Buy credits / plans
/sites/:slug/_pf_auth      Custom login page for protected sites
```

---

## UX-01 — Registration and Onboarding

### Login `/login`

- SSO Google / GitHub (OAuth2)
- Native email + password with magic-link verification (valid 24h)
- First access → `/onboarding`; subsequent access → `/dashboard`

### Onboarding `/onboarding`

A single screen, 3 blocks:

**Block A — Profile (optional, skippable)**

```
What's your name? [First name] [Last name]
What will you use Andy Code Cat for?
  ○ For myself / my own business
  ○ For my clients (agency/freelance)
  ○ To test ideas
```

**Block B — GDPR consents (mandatory)**

```
☑ I accept the Terms of Service and Privacy Policy
☐ I consent to marketing communications (optional)
☐ I consent to data use for service improvement (optional)
```

**Block C — Inline cookie banner**

```
[Necessary only]  [Accept all]
```

CTA: "Start creating →" → 50 free credits added → `/dashboard`

---

## UX-02 — Dashboard `/dashboard`

```
┌──────────────────────────────────────────────────────┐
│  Andy Code Cat      [+ New project]           👤 Massi   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │ 🟢 LIVE      │ │ ⚙️ Generating│ │      +      │  │
│  │ SpeedRank    │ │ PayFlow      │ │   New       │  │
│  │ ↗ Visit     │ │ ⏳ 2 min...  │ │  project    │  │
│  └──────────────┘ └──────────────┘ └─────────────┘  │
│                                                      │
│  Credits: 34 / 50   [Top up]                          │
└──────────────────────────────────────────────────────┘
```

- Status card: draft / generating / generated / live / error
- Persistent credit bar
- Projects in generation: animated spinner, no attention required

---

## UX-03 — Creation Wizard `/projects/new`

**Philosophy:** conversational. Earlier steps collapse, showing a summary.

### Step 1 — Idea input

```
  Describe your idea 💬
  ┌────────────────────────────────────────────┐
  │ E.g. "Landing page for my pizzeria..."     │
  └────────────────────────────────────────────┘
  min 20 char                      [Next →]
```

### Step 2 — Visual style

- 10 preset themes with PNG preview (300×200)
- Filters: Minimal / Bold / Elegant / Playful / Dark / Corporate
- Optional selection ("Skip" available)

**MVP theme library:**

| ID | Name | Palette | Font |
|---|---|---|---|
| minimal-white | Alba | White/Slate | Inter |
| bold-dark | Midnight | Black/Gold | Space Grotesk |
| elegant-serif | Cartier | Cream/Bordeaux | Playfair Display |
| playful-color | Confetti | Pastels | Nunito |
| dark-tech | Matrix | Black/Neon green | JetBrains Mono |
| corporate-blue | Atlantic | Navy/White | DM Sans |
| warm-startup | Terracotta | Orange/Sand | Plus Jakarta Sans |
| clean-saas | Vercel | White/Black/Purple | Geist |
| nature-green | Foresta | Green/Beige | Lora |
| luxury-gold | Aurum | Black/Gold | Cormorant |

### Step 3 — Attached document

- Drag-and-drop upload: PDF, DOC, DOCX, TXT, MD
- Max 10MB, 1 file for the MVP
- Optional ("Skip" available)

### Step 4 — Photos

- Multiple upload: max 6 images JPG/PNG/WebP, 5MB each
- Immediate thumbnail preview
- GDPR note on image usage

### Step 5 — Generated brief (auto, ~2-3s wait)

The brief is processed **in the background during steps 1-4** with a lightweight LLM call (Haiku/Flash).

```
┌───────────────────────────────────────────────────┐
│ ✨ I've worked out your idea                       │
│                                                   │
│ 🍕 Landing page — Neapolitan Pizzeria             │
│                                                   │
│ **Goal:** Present the pizzeria, show the menu     │
│ and collect bookings.                             │
│                                                   │
│ **Sections:**                                     │
│ • Hero with photo and main tagline                │
│ • Menu (from the attached PDF)                    │
│ • Photo gallery                                   │
│ • Booking form                                    │
│ • Footer with map and contacts                    │
│                                                   │
│ **Style:** Bold Dark · **Language:** Italian      │
└───────────────────────────────────────────────────┘

Want to correct or refine it?
┌────────────────────────────────────────────────┐
│ E.g. "add a testimonials section..."           │
└────────────────────────────────────────────────┘

Estimated cost: ~8 credits   Available: 34

        [← Edit]   [🚀 Start generation]
```

- If credits are insufficient: button disabled + top-up link
- Credit estimate: `base(5) + pdf(2) + images(n×0.5) + loops(n×1.5)`

---

## UX-04 — Project Workspace `/projects/:id`

### During generation

```
⚙️ Building your site...

████████████████░░░░  65%

✅ Brief processed
✅ Project structure created
✅ HTML and CSS generated
⏳ Generating images... (2/4)
○  Automatic quality check
○  Final optimization

[Detailed log ▼]  (collapsed by default)

Credits consumed: 4/8 estimated
```

- Real-time updates via SSE
- Log collapsed by default, expandable
- The user can close the tab and come back: state is persisted

### Automatic check (post-generation)

```
✅ Site generated
✅ Images processed
⏳ Quality check... (iteration 1/3 — configurable)
   → HTML analysis with Playwright
   → Content-match verification with the LLM
   → Automatic correction if needed
```

The maximum number of iterations is configurable per project (default: 3).

### Site ready

```
┌────────────────────────────────────────────────────┐
│ ✅ Your site is ready!                             │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │                                              │  │
│  │          [IFRAME PREVIEW]                   │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│  [📱 Mobile]  [💻 Desktop]   [↗ Open in new tab]   │
│                                                    │
│  ┌─────────────────┬──────────────────────────┐    │
│  │ 💬 Edit          │ 🌐 Publish online         │    │
│  └─────────────────┴──────────────────────────┘    │
│                                                    │
│  Credits used: 7   Remaining: 27                   │
└────────────────────────────────────────────────────┘
```

---

## UX-05 — Editing / Refinement

Side panel or modal:

```
What do you want to change?
┌──────────────────────────────────────────────────┐
│ E.g. "Change the color to red, add prices"       │
└──────────────────────────────────────────────────┘

Estimated cost: ~3 credits
Manual iterations remaining: 2 (max: 3)

              [Cancel]   [Apply change]
```

If manual iterations are exhausted:
> "You've reached the edit limit. Publish the site and keep editing the files directly, or start a new project."

---

## UX-06 — Publish Wizard `/projects/:id/publish`

### Step 1 — Site name

```
Current name (temporary, visible only to you):
  velvet-phoenix-42.Andy Code Cat.io

Choose your address:
┌──────────────────────────┐
│ pizzeria-napoli          │.Andy Code Cat.io
└──────────────────────────┘
✅ Available!

Or use your own domain:
┌──────────────────────────┐
│ www.pizzerianapoli.it    │
└──────────────────────────┘
ℹ️ We'll guide you through DNS setup.
```

- Generated temporary name: `{adjective}-{animal}-{number}` (e.g. `velvet-phoenix-42`)
- Real-time uniqueness validation (across all projects, all users)
- Lowercase, numbers, hyphens only; min 3, max 63 chars

### Step 2 — Visibility

```
○ 🌍 Public
   Anyone with the link can view it. Indexed.

● 🔒 Password-protected
   ┌────────────────────────────┐
   │ Choose a password           │
   └────────────────────────────┘
   Andy Code Cat-branded login page.
   7-day session cookie for visitors.

○ 👁 Private (you only)
   Visible only when logged in to Andy Code Cat.
   Not indexed.
```

### Step 3 — Publishing in progress

```
✅ Files copied to webroot
✅ Nginx configured
✅ Let's Encrypt SSL activated
✅ Site online!

🎉 https://pizzeria-napoli.Andy Code Cat.io

[↗ Visit]   [📋 Copy link]   [Dashboard]

📧 Recap sent by email.
```

**Automatic recap email:**

- URL of the published site
- Credits used / remaining
- Links to: project management, ZIP export, custom domain DNS guide
- PDF attachment: project-specific quick-start guide

---

## UX-07 — Out of Credits

```
⚠️ Out of credits

Generation is paused. The project is saved.

Credits remaining: 0
Credits needed: ~3

[20 credits — €2.99]
[100 credits — €9.99]  ← Recommended
[Pro plan — €19/month — unlimited credits]

[See what's been generated so far]
```

- Session saved in MongoDB (`status: 'paused_credits'`)
- Partial files preserved in a git branch
- On top-up: generation automatically resumes from where it left off

---

## UX-08 — Custom Domain

From `/projects/:id/settings` → "Domain" tab:

```
Current domain: pizzeria-napoli.Andy Code Cat.io

Custom domain:
┌─────────────────────────────┐
│ www.pizzerianapoli.it       │
└─────────────────────────────┘

Configure your domain's DNS:

  Type    Name    Value
  A       @       185.xxx.xxx.xxx
  A       www     185.xxx.xxx.xxx

ℹ️ DNS propagation can take 1-48 hours.

[Verify DNS configuration]
Status: ⏳ Waiting for propagation

Once DNS is active, SSL will be
configured automatically (Let's Encrypt).
```

---

## UX-09 — Collaboration

From `/projects/:id/settings` → "Sharing" tab:

```
Invite collaborators:
┌───────────────────────────┐  [Invite]
│ email@example.com         │
└───────────────────────────┘

Collaborators:
👤 marco@studio.it    [Can edit ●]     [✕]
👤 sara@cliente.com   [Read only ○]    [✕]

Shareable preview link (no login):
[Enable public link]
https://Andy Code Cat.io/preview/abc123xyz
```

---

## UX-10 — Password-Protected Site

Page served by Andy Code Cat before showing the site:

```
┌─────────────────────────────────────┐
│                                     │
│              🔒                     │
│   pizzeria-napoli.Andy Code Cat.io      │
│                                     │
│   Password-protected site           │
│   ┌─────────────────────────────┐   │
│   │ Enter the password           │   │
│   └─────────────────────────────┘   │
│                  [Sign in]          │
│                                     │
│   ──────────────────────────────   │
│   Powered by Andy Code Cat              │
│   [Create your site for free →]     │
│                                     │
└─────────────────────────────────────┘
```

- Handled by nginx: `location = /_pf_auth` intercepts before static files
- Cookie `pf_site_auth_{slug}` JWT, 7 days
- Password bcrypt-hashed in MongoDB
