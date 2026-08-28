# andy code cat — Product Vision & Vertical Strategy

> Product vision document. It contains no code instructions, only strategic directions, high- and mid-level UX functionality, and development implications for each market vertical. The document is meant as application context to orient development decisions, not as a technical spec.

---

## Index

1. [Cross-cutting foundations — Core features and general directions](#1-cross-cutting-foundations)
2. [Vertical: Web Agency & Freelance](#2-vertical-web-agency--freelance)
3. [Vertical: Schools & Universities](#3-vertical-schools--universities)
4. [Vertical: Nonprofits & Associations](#4-vertical-nonprofits--associations)
5. [Vertical: Small Business — Direct SaaS](#5-vertical-small-business--direct-saas)
6. [Vertical: Ad-Space Sellers](#6-vertical-ad-space-sellers)
7. [Vertical: Events & Trade Fairs — On-Site Kiosks](#7-vertical-events--trade-fairs--on-site-kiosks)
8. [Vertical: Gaming & Community](#8-vertical-gaming--community)
9. [Vertical: Developers & Open Source](#9-vertical-developers--open-source)
10. [Cross-cutting layers — Pre-prompting, Branding, Moderation](#10-cross-cutting-layers)
11. [Roadmap by priority](#11-roadmap-by-priority)

---

## 1. Cross-cutting foundations

Andy is a self-contained web visual content generator. Its central value is the ability to turn a textual intent into a working, exportable, independent web artifact. All the vertical-specific customization work builds on this core.

### 1.1 The pre-prompting engine

Pre-prompting is andy's main differentiator compared to a simple LLM wrapper. It's not about building better prompts for the user, but about creating a system of composable layers that wrap the user's intent with context, constraints, style, and goals the user doesn't need to know about or manage.

**Development directions:**

- A system of composable, stackable layers, where each layer adds to or constrains the generation context
- Separate layers for: visual identity, tone of voice, output format, ethical constraints, mandatory assets
- Support for user layers (what the user writes), operator layers (what the installation adds), and brand layers (what the end client imposes)
- A layer management interface accessible only to the instance administrator
- Layers exportable and importable as configuration, so a vertical can be replicated across multiple installations

### 1.2 Multi-model and multi-provider as infrastructure

Model choice isn't a technical detail but a product dimension. Different verticals require different profiles: speed, quality, privacy, cost, offline availability.

**Development directions:**

- Model selection separate for the optimization phase and the generation phase — the two moments have different profiles
- Pre-configured model profiles per vertical (e.g. "school" automatically suggests local models)
- Centralized API key management with quotas per user and per tenant
- Automatic fallback between providers on error or unavailability
- Estimated cost indicator before generation, configurable to be visible or hidden from the end user
- Support for local models like Ollama and LM Studio as a first-class option, not a second-tier integration

### 1.3 Output as a portable artifact

The value of the ZIP output isn't purely technical. It's a promise of freedom: the generated content belongs to whoever requested it, works anywhere, and requires no subscription or cloud service to be published.

**Development directions:**

- Output that is always and unconditionally self-contained: zero external dependencies, zero CDN, zero network requests at runtime
- Option to publish directly to a domain managed by the andy instance
- Public or private gallery of generated outputs, with visibility control
- Generation history with the ability to re-edit, regenerate, or fork a previous output
- Output versioning: every regeneration creates a new version, previous ones remain accessible
- Export to alternative formats where applicable (PDF from HTML, image from slide)

### 1.4 The editor as a creative environment

The WYSIWYG editor and the HTML editor are today refinement tools. The direction is to make them full-fledged creative environments, not just output correctors.

**Development directions:**

- In-place editing with partial regeneration: select an element and request its regeneration without touching the rest
- Contextual suggestions during editing, based on the type of content selected
- Composable content blocks: not everything has to be generated in a single shot — sections can be composed
- A "guided" editing mode: the user indicates the direction, andy adjusts
- Multi-level undo/redo with a visual diff between states
- Integrated responsive preview (mobile, tablet, desktop) without leaving the editor

---

## 2. Vertical: Web Agency & Freelance

### Context

The CEO of a web agency doesn't use andy directly: they configure it and delegate it to their collaborators, or integrate it into production workflows for clients. The value isn't the single generation but the ability to industrialize content production while maintaining brand quality and consistency.

### High-level functionality

**Multi-client (tenant) management**
Each agency client is a separate entity with its own brand kit, its own pre-prompting layers, its own enabled users, and its own output gallery. The agency manages all tenants from a single panel. Each tenant sees only its own content.

**Per-client brand kit**
A brand kit is the set of information andy uses to steer every generation: color palette, fonts, logo, tone of voice, industry, words to use and words to avoid, preferred format. The brand kit isn't visible to the end user, but wraps every one of their requests.

**Proprietary output templates**
The agency can define structural — not stylistic — templates that guide the shape of the output. A "restaurant landing page" template defines the expected sections (hero, menu, contact, map), leaving the generation free to fill them in. Templates are agency assets, not user assets.

**Approval workflow**
Every output generated by the client can be sent for review to the agency before publication. The agency approves, requests changes, or rejects. The flow is asynchronous and notified.

**Production reporting**
How many generations has each client requested? What formats? What models were used? What's the estimated token cost? This data feeds billing and planning.

### Mid-level functionality

- Quick cloning of brand kits between similar clients
- Brand kit preview on a sample output before activating it
- Shared asset library across tenants (icons, patterns, agency graphic elements)
- Monthly generation limit per client, configurable per commercial plan
- API access to integrate andy into the agency's CMS or management system
- Version history per client, with rollback capability
- Export of a client's entire output portfolio as a ZIP archive

### Development implications

The multi-tenancy system is the enabling feature for this vertical. Without it, andy is an individual tool, not an agency product. The data structure for users, brand kits, and outputs must account for tenant separation from the start. The approval workflow requires an output status system (draft, in review, approved, published). Reporting requires generation logging with metadata (cost, model, format, user, tenant).

---

## 3. Vertical: Schools & Universities

### Context

Andy in a school context isn't an assistant, it's a teaching tool. The goal isn't to produce the best content but to let the user — the student — live through the production process. Output quality is secondary to the quality of the learning experience.

### High-level functionality

**Lab mode**
An alternative operating mode to the normal interface, designed for guided sessions. The teacher defines a path: topic, prompt constraints, model to use, output format. The student operates within these constraints. Lab mode shows the steps explicitly, makes the optimized prompt visible, shows the process instead of hiding it.

**School creative board**
A public (but moderated) gallery of outputs generated by students, hosted on the institution's domain. Students see their own published work, teachers moderate. The board is an educational artifact in itself: it motivates, creates comparison, shows evolution over time.

**Model profiles for the school context**
In a school setting, student privacy is a non-negotiable constraint. Andy must make exclusive use of local models simple and safe, without requiring technical skills from the teacher. A "school" profile automatically configures: no data sent to external providers, a local model pre-selected, minimal logs.

**Structured prompting paths**
Guided sequences of progressive prompting: the teacher defines a sequence of exercises where each step builds on the previous one. The student learns to refine, specify, and correct their own prompt by observing how the output changes.

**Prompt evaluation**
Not of the output, but of the prompt. A sub-system that analyzes the quality and specificity of the prompt written by the student and gives formative feedback: is it too vague? does it lack context? does it use ambiguous words? This is a tool for the teacher, not an automatic judge.

### Mid-level functionality

- Export of student outputs as an archive for teacher evaluation
- Integration with electronic gradebook systems (via API) to associate outputs with students and classes
- Anonymous mode for exercises where identity must not influence evaluation
- Session timer for timed exercises
- Side-by-side comparison of outputs generated from different prompts on the same topic
- Teacher dashboard with an overview of class activity
- Configurable moderation threshold for the board (manual, semi-automatic)

### Development implications

Lab mode requires a level of session configuration not covered by the standard architecture. It's essentially a second entry point into the application with a completely different UX flow. The school board requires a moderation system with roles (student, teacher, institution administrator). The "school privacy-first" profile requires that routing to cloud providers be disableable at the instance level, not just per individual user.

---

## 4. Vertical: Nonprofits & Associations

### Context

Nonprofit organizations have limited resources, uneven digital skills, and concrete communication needs: announcements, flyers, forms, campaign landing pages. For them, andy must be the simplest possible tool, with the shallowest learning curve and the greatest practical effect.

### High-level functionality

**Operational templates by content type**
Pre-configured output templates for typical needs: event flyer, fundraising page, sign-up form, visual press release, volunteer update. Each template isn't a fixed layout but a set of intents and structures that guide the generation in the right direction.

**Simplified mode**
An interface stripped to the essentials: write what you need, choose the format, generate. No reference to LLM, provider, tokens, pre-prompting. Andy decides for the user. Simplified mode is the default for this vertical; advanced mode is accessible but not front and center.

**Export optimized for print and social**
Nonprofits need physical flyers and social posts, not just web pages. PDF export with correct print margins, image export sized for major social networks, print-ready A4 export for the print shop.

**Reusable content library**
Over time, the association accumulates content that repeats: its own story, its mission, its contacts, event photos. Andy should be able to draw on this library during generation without the user having to rewrite it every time.

### Mid-level functionality

- Account sharing among volunteers with differentiated roles
- Notification to volunteers when content is ready to be distributed
- Simple editorial calendar: plan when content should be generated and published
- Integration with fundraising platforms to automatically insert links and widgets into generated content
- Offline mode: generation with a local model when the connection is unstable
- Free or heavily discounted access as a dedicated program

### Development implications

Simplified mode requires a second UX flow with automatic decisions that today are explicit. The reusable content library system is a form of instance memory: andy must be able to inject persistent, organization-related information into the prompt without the user rewriting it every time. This anticipates an "organization context" system that cuts across multiple verticals.

---

## 5. Vertical: Small Business — Direct SaaS

### Context

The owner of a small business doesn't know what an LLM is and doesn't want to. They need a landing page for their pizzeria, a flyer for the weekend special, a page for their event. For them, andy must be a tool as simple as Canva, but with the output they actually want: a working web page, not a template to fill in.

### High-level functionality

**Onboarding by industry**
On first access, andy asks: what kind of business do you have? In three clicks (restaurant, shop, service, other) it configures a profile that steers all subsequent generations. The pizzeria gets output with a menu, hours, map, and atmosphere. The hairdresser gets output with services, booking, and a gallery. Industry is the most important pre-prompting layer for this vertical.

**Generation from voice or photo prompts**
Small businesses don't always find writing easy. Andy should accept input in different forms: a photo of a hand-written menu, a photo of the storefront, a voice message describing the day's special. Multimodal input decisively lowers the barrier to entry.

**Publishing with a custom domain**
The owner wants their page on "pizzeria-daluigi.it", not on an andy subdomain. Custom domain management, even just via redirect or CNAME, is a high perceived-value feature for this segment.

**Automatically generated QR code**
Every published page automatically generates a downloadable, print-ready QR code. The QR code is the physical-digital touchpoint that small businesses understand and use.

**Fast content updates**
The pizzeria changes its menu every week. Andy must allow fast updates to specific elements (menu, offers, hours) without regenerating everything. A guided editing mode for variable content is more useful than full regeneration.

### Mid-level functionality

- Notification when a published page is visited (minimal analytics)
- Proactive suggestion: "It's Friday, want to update the weekend offers?"
- Integration with Google Business Profile to automatically import hours and information
- Seasonal mode: templates and tone change automatically based on the time of year
- Free plan with a generation limit, paid plan with no limits and a custom domain
- WhatsApp or chat support for users not comfortable with the web interface

### Development implications

Multimodal input (photo, voice) requires preprocessing before the LLM: OCR for images, speech-to-text for audio, then transformation into a structured prompt. The fast-update system requires the generated output to have a semantic structure that andy knows and can modify surgically, not just as raw text. The QR code is a relatively simple but high perceived-impact feature: it should be implemented early and made visible.

---

## 6. Vertical: Ad-Space Sellers

### Context

A local publisher, an ad agency, or a billboard network sells space. The content to show in that space — the landing page, the mini site, the digital poster — is today the client's problem. Andy lets the publisher offer the content as part of the advertising package, increasing the perceived value of the offer without proportionally increasing costs.

### High-level functionality

**Full white label**
Andy disappears entirely. The interface, the domain, the communication belong to the seller. The end client doesn't know andy exists. White labeling isn't just cosmetic: it includes the ability to customize the flow, the available options, the offered formats.

**Format packages**
The seller defines what can be generated: only landing pages? only digital posters? only one-scroll mini sites? The user sees only the options included in their commercial package. Package configuration happens in the seller's panel, not the user's.

**Publishing on the publisher's domain**
Content generated by clients is published on a subdomain of the publisher (client1.publisher.com), not on an andy domain. This keeps traffic within the publisher's ecosystem and reinforces the value of the relationship.

**Expiration management**
An advertising package has a duration. The generated landing page should expire along with the campaign. Andy manages publication expiration: notifies the client in advance, offers renewal, archives the content on expiry.

**Reporting for the seller**
How many landing pages were generated? How many are active? How many visits did they receive? The seller needs this data to demonstrate the service's value to their clients and for renewals.

### Mid-level functionality

- Onboarding templates for the seller's client (not for the seller themselves)
- Integration with the seller's CRM to automatically import client data into the output
- Automatic email to the client with a link to their landing page and an attached QR code
- Limit on post-generation edits per commercial plan
- Optional watermark on the output (e.g. "made with [publisher name]")

### Development implications

This vertical requires a three-level hierarchy: andy as the platform, the seller as the operator, the end client as the user. White labeling requires customizing the interface at the theme and copy level, not just the logo. Expiration management requires a scheduling and notification system. Integration with external CRMs is a point of significant complexity but high value.

---

## 7. Vertical: Events & Trade Fairs — On-Site Kiosks

### Context

A physical booth at a trade fair is a hybrid object: it's a screen, but it's also an experience. People approach, interact, and take something away. Andy as a "content machine" at a fair generates experiential value, not just functional value: the visitor took part in creating something, rather than simply receiving promotional material.

### High-level functionality

**Kiosk mode**
A stripped-down, touch-friendly interface, designed for screens in vertical or horizontal orientation, operated by people who don't know andy. Simple input, fast output, no technical detail. Kiosk mode disables everything not needed for the experience: account, settings, history.

**Brand lock**
The event's or sponsor's brand is immutable. Logo, colors, tagline, font are injected into a mandatory layer and cannot be removed or modified by the user. The visitor has creative freedom over the content but not over the visual identity. Brand lock is a contractual guarantee andy must be able to offer.

**Fast generation**
At a fair, waiting time is a critical constraint. Generation must be optimized for speed: smaller and faster models, simplified outputs, pre-generation of common elements. The user should see the result in 10-15 seconds, not 60.

**Immediate export**
The visitor wants to take their content with them. A QR code generated instantly to download it to their phone, direct email, or immediate download to a USB drive. More options, less friction.

**Anonymous sessions**
At a fair, nobody wants to register. Sessions are anonymous, without an account. Generated content is either temporary server-side or downloaded immediately. Privacy is a feature, not a constraint.

### Mid-level functionality

- Real-time generation counter visible on the interface (engagement gamification)
- Live public gallery: outputs generated during the event appear on a separate screen
- Automatic moderation before publication to the gallery
- Post-event report: how many generations, which formats, which topics were most requested
- Remote configuration of the kiosk (brand kit change, theme update) without physical intervention
- Pre-loaded demo mode for when the connection is unstable

### Development implications

Kiosk mode is an entry point completely different from the standard application, with UX requirements (touch, large screen, simplified input) and system requirements (anonymous sessions, no account, fast generation) far removed from the normal use case. Brand lock requires certain layer elements to be flagged as non-modifiable at the system level, not just the interface level. The live gallery requires a real-time channel between generations and the display.

---

## 8. Vertical: Gaming & Community

### Context

Andy can generate working HTML casual games. This is a use case with no direct equivalent in the no-code tool market: the generation of interactive experiences, not just passive content. The gaming vertical is still to be explored but has very high differentiation potential.

### High-level functionality

**Pre-configured game genres**
Generating a game from scratch requires a very rich prompt. Andy can offer pre-configured genres — runner, quiz, puzzle, memory, clicker — that define the base mechanics and leave the user to customize theme, characters, and narrative. Genre is the structure layer, the prompt is the content layer.

**Assisted balancing**
A game that works but is impossible or trivial isn't a good game. Andy should automatically apply balancing constraints based on genre: progression speed, obstacle frequency, difficulty curve. These parameters aren't visible to the user but are part of the generation layer.

**Mandatory branded assets**
For the events and fairs vertical, the game's characters, backgrounds, and graphic elements can be pre-defined by the organizer. The visitor customizes the story or the character's name, but always plays with the event's visual identity.

**Integrated leaderboard**
A game without competition loses half its value. Andy should be able to generate output that includes a leaderboard, shared among all players of the same game. The leaderboard is a service, not a static file: it requires a minimal backend or an integration with an external service.

**Export for streaming and social**
Content creators want to show off their games. Export in a format optimized for OBS (transparent overlay), automatic screenshot of the game screen, short gameplay clip for social media.

### Mid-level functionality

- Game parameter editor: speed, difficulty, duration — without touching code
- Quick gameplay preview before export
- Local multiplayer mode (same screen, two inputs) for event contexts
- Integration with gaming community platforms (itch.io, Newgrounds) for direct publishing
- Variant generation: same game, different theme, for seasonal campaigns

### Development implications

The casual game is the most complex type of output andy can generate: it requires working game logic, not just visual content. Pre-prompting for genres must be far more structured and tested than for other formats. Assisted balancing requires gaming domain knowledge that must be encoded in the layer, not left to the LLM. The leaderboard breaks the self-contained paradigm: it's the first case where the output needs an external service to work fully.

---

## 9. Vertical: Developers & Open Source

### Context

Developers are andy's first users and its first contributors. They use andy differently from everyone else: they integrate it, fork it, extend it, deliberately break it. Their value isn't in the generations they produce but in the direction they give the project.

### High-level functionality

**API-first as the primary access mode**
Every andy feature must be accessible via REST API before it's accessible via the interface. The developer doesn't use the UI, they use the API. The UI is a client of the API, not the other way around. This inversion of perspective has deep architectural implications.

**Plugin system for the pre-prompting layer**
The developer wants to inject their own context into the generation system. A plugin system allows adding custom layers without modifying the core. A plugin can be a configuration file, a script, or an external endpoint that andy calls during the pre-prompting phase.

**Pre-prompting debug mode**
The developer wants to see exactly what's sent to the LLM. A debug mode shows the full prompt, including all layers, before and after optimization. This isn't visible to the normal user but is essential for anyone developing custom layers.

**Webhooks for generation events**
Every completed generation can notify an external endpoint: output ready, download link, metadata. The developer can integrate andy into CI/CD pipelines, automatic publishing systems, or content operation workflows.

**Containerization and simplified deployment**
Andy must be easy to deploy in different environments: Docker, VPS, Raspberry Pi, internal company server. Configuration must be minimal and documented. A developer who wants a private instance shouldn't have to fight the infrastructure.

### Mid-level functionality

- CLI for terminal generation, without a UI
- SDK in at least one common language (Python or JavaScript) for integrations
- Interactive API documentation (OpenAPI/Swagger) generated automatically
- Output testing system: automatic verification that the generated file is valid HTML, JS, CSS
- Changelog of pre-prompting system changes between versions
- Separate staging environment for testing new layers without impacting production

### Development implications

API-first requires the entire application logic to be decoupled from the interface. If the UI and backend are coupled today, this is the direction to separate them. The plugin system is the most complex development feature but also the one with the greatest community impact: it lets anyone contribute new verticals without modifying the core. Webhooks require an asynchronous event management system. The CLI is relatively simple but has high symbolic value for the open source community.

---

## 10. Cross-cutting layers

### 10.1 The organization context system

Cutting across multiple verticals, the need for persistent instance memory clearly emerges. The agency that doesn't want to rewrite the client's brand, the pizzeria that doesn't want to re-enter the menu every time, the school that wants to constrain students' prompts: all of them need a system that knows "who I am" and "how I work" without the user having to restate it every time.

The organization context is a layer of persistent information, managed by the instance administrator, that is automatically included in every generation. It isn't a template — it's a set of facts and constraints andy always knows.

### 10.2 The moderation system

Any vertical that involves public output — the school board, the event gallery, the agency client's landing page — needs a moderation system. Moderation can be:

- Manual: an administrator approves each output before publication
- Semi-automatic: an automatic filter blocks problematic content, the rest goes through
- Automatic: no human intervention, filters only

The moderation system must be configurable per vertical, not hardcoded. What's acceptable in a trade fair context isn't in a school context.

### 10.3 The analytics system

Andy doesn't know what happens after publication. How many people see the generated landing page? For how long? Where do they come from? This data is valuable for all verticals, especially for the agency and the ad-space seller. A minimal analytics system — visit counter, referrer, session time — integrated directly into the generated output would add significant value without complicating the self-contained model.

### 10.4 The recurring assets system

Logo, fonts, product images, staff photos: these assets repeat in every generation for the same client. An asset library system tied to the profile or tenant allows:

- Automatically injecting the relevant assets into the generation prompt
- Including the physical assets in the ZIP output without the user having to upload them every time
- Managing asset usage rights (which are available for which generations)

---

## 11. Roadmap by priority

### Immediate — Foundations for all verticals

- Composable, configurable pre-prompting layer system
- Basic multi-tenancy (user and output separation per organization)
- Persistent organization context
- Complete, documented REST API

### Short term — P1 verticals

- Per-client brand kit (for agencies)
- Onboarding by industry (for small businesses)
- Privacy-first profile with mandatory local models (for schools)
- Automatic QR code on every published output
- PDF and image export from HTML

### Medium term — P2 verticals and advanced features

- Full white label (for ad-space sellers)
- Touch-friendly kiosk mode (for events)
- Lab mode with structured paths (for schools)
- Configurable moderation system
- Output approval workflow
- Webhooks for generation events

### Long term — P3 verticals and differentiators

- Pre-configured game genres (for gaming)
- Plugin system for custom layers (for developers)
- Leaderboard as a service for gaming output
- Multimodal input: photo and voice (for small businesses)
- Analytics integrated into published outputs
- CLI and SDK

---

> *This document is a starting point, not a spec. The directions described here are strategic orientations: every feature will need to be validated with real users before being developed. Real priority emerges from usage, not from planning.*
