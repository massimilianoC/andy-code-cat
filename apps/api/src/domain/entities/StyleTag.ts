/**
 * Style Tag Taxonomy — static catalog used for user onboarding
 * profiling and per-project moodboard configuration.
 *
 * Tags are grouped by category (TC-*). A user picks 0–5 tags per category.
 * No DB storage needed — this is a pure static descriptor catalog.
 */

export type TagCategory =
    | "identity"
    | "sector"
    | "audience"
    | "visual"
    | "palette"
    | "typography"
    | "layout"
    | "tone"
    | "reference"
    | "feature"
    | "era";

export interface StyleTagDefinition {
    id: string;              // e.g. "visual:minimal"
    category: TagCategory;
    label: string;           // display label
    emoji?: string;          // optional icon
    description?: string;    // short description for tooltip
    incompatibleWith?: string[]; // mutually exclusive tag ids
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const STYLE_TAG_CATALOG: StyleTagDefinition[] = [
    // TC-IDENTITY
    { id: "identity:freelancer", category: "identity", label: "Freelancer", emoji: "💼" },
    { id: "identity:agency", category: "identity", label: "Agenzia", emoji: "🏢" },
    { id: "identity:startup", category: "identity", label: "Startup", emoji: "🚀" },
    { id: "identity:enterprise", category: "identity", label: "Enterprise", emoji: "🏗️" },
    { id: "identity:non-profit", category: "identity", label: "Non-profit", emoji: "🤝" },
    { id: "identity:hobbyist", category: "identity", label: "Hobbyist", emoji: "🎨" },

    // TC-SECTOR
    { id: "sector:food-beverage", category: "sector", label: "Food & Drink", emoji: "🍽️" },
    { id: "sector:tech-saas", category: "sector", label: "Tech / SaaS", emoji: "💻" },
    { id: "sector:fashion", category: "sector", label: "Moda", emoji: "👗" },
    { id: "sector:health-wellness", category: "sector", label: "Salute & Benessere", emoji: "🌿" },
    { id: "sector:education", category: "sector", label: "Istruzione", emoji: "📚" },
    { id: "sector:real-estate", category: "sector", label: "Immobiliare", emoji: "🏠" },
    { id: "sector:creative-arts", category: "sector", label: "Arte & Creatività", emoji: "🎭" },
    { id: "sector:finance", category: "sector", label: "Finanza", emoji: "💰" },
    { id: "sector:travel", category: "sector", label: "Viaggi", emoji: "✈️" },
    { id: "sector:sport", category: "sector", label: "Sport", emoji: "⚽" },
    { id: "sector:ecommerce", category: "sector", label: "E-commerce", emoji: "🛍️" },
    { id: "sector:photography", category: "sector", label: "Fotografia", emoji: "📷" },

    // TC-AUDIENCE
    { id: "audience:b2b", category: "audience", label: "B2B", emoji: "🤝" },
    { id: "audience:b2c", category: "audience", label: "B2C", emoji: "👤" },
    { id: "audience:local-community", category: "audience", label: "Comunità locale", emoji: "📍" },
    { id: "audience:professionals", category: "audience", label: "Professionisti", emoji: "👔" },
    { id: "audience:young-adults", category: "audience", label: "Giovani adulti", emoji: "🧑" },
    { id: "audience:families", category: "audience", label: "Famiglie", emoji: "👨‍👩‍👧" },
    { id: "audience:luxury-clients", category: "audience", label: "Clientela luxury", emoji: "💎" },

    // TC-VISUAL
    { id: "visual:minimal", category: "visual", label: "Minimal", emoji: "⬜", incompatibleWith: ["visual:bold", "visual:dense-info"] },
    { id: "visual:bold", category: "visual", label: "Bold", emoji: "💥", incompatibleWith: ["visual:minimal"] },
    { id: "visual:elegant", category: "visual", label: "Elegante", emoji: "✨" },
    { id: "visual:playful", category: "visual", label: "Giocoso", emoji: "🎪" },
    { id: "visual:dark", category: "visual", label: "Dark", emoji: "🌑" },
    { id: "visual:corporate", category: "visual", label: "Corporate", emoji: "🏛️" },
    { id: "visual:vintage", category: "visual", label: "Vintage", emoji: "📻" },
    { id: "visual:futuristic", category: "visual", label: "Futuristico", emoji: "🤖" },
    { id: "visual:organic", category: "visual", label: "Organico", emoji: "🌱" },
    { id: "visual:brutalist", category: "visual", label: "Brutalist", emoji: "🧱" },
    { id: "visual:glassmorphism", category: "visual", label: "Glassmorphism", emoji: "🪟" },

    // TC-PALETTE
    { id: "palette:warm-sunset", category: "palette", label: "Tramonto Caldo", emoji: "🌅", description: "#E07A5F + #3D405B" },
    { id: "palette:ocean-blue", category: "palette", label: "Oceano Profondo", emoji: "🌊", description: "#0077B6 + #023E8A" },
    { id: "palette:earth-tones", category: "palette", label: "Terra e Natura", emoji: "🌍", description: "#606C38 + #283618" },
    { id: "palette:neon-vivid", category: "palette", label: "Neon Vivace", emoji: "🌈", description: "#7209B7 + #F72585" },
    { id: "palette:monochrome-dark", category: "palette", label: "Monocromo Scuro", emoji: "🖤", description: "#212529 + #495057" },
    { id: "palette:pastel-soft", category: "palette", label: "Pastello Morbido", emoji: "🌸", description: "#FFB5A7 + #FCD5CE" },
    { id: "palette:forest-green", category: "palette", label: "Verde Foresta", emoji: "🌲", description: "#2D6A4F + #40916C" },
    { id: "palette:royal-gold", category: "palette", label: "Oro Regale", emoji: "👑", description: "#C9A227 + #1B1B2F" },
    { id: "palette:coral-blush", category: "palette", label: "Corallo", emoji: "🪸", description: "#FF6B6B + #EE5A24" },
    { id: "palette:ice-silver", category: "palette", label: "Ghiaccio Argento", emoji: "❄️", description: "#A8DADC + #457B9D" },

    // TC-TYPOGRAPHY
    { id: "typo:sans-serif-clean", category: "typography", label: "Sans-serif pulito", emoji: "Aa" },
    { id: "typo:serif-editorial", category: "typography", label: "Serif editoriale", emoji: "Áá" },
    { id: "typo:mono-tech", category: "typography", label: "Monospace tech", emoji: "[]" },
    { id: "typo:handwritten-casual", category: "typography", label: "Corsivo casual", emoji: "✍️" },
    { id: "typo:display-bold", category: "typography", label: "Display bold", emoji: "𝗕" },
    { id: "typo:mixed-contrast", category: "typography", label: "Mix serif+sans", emoji: "II" },

    // TC-LAYOUT
    { id: "layout:hero-first", category: "layout", label: "Hero in primo piano", emoji: "🖼️" },
    { id: "layout:card-grid", category: "layout", label: "Griglia di card", emoji: "🃏" },
    { id: "layout:single-column", category: "layout", label: "Colonna singola", emoji: "📄" },
    { id: "layout:asymmetric", category: "layout", label: "Asimmetrico", emoji: "↔️" },
    { id: "layout:full-bleed-images", category: "layout", label: "Immagini full-bleed", emoji: "🖼️" },
    { id: "layout:whitespace-heavy", category: "layout", label: "Aria e spazio", emoji: "⬜" },
    { id: "layout:dense-info", category: "layout", label: "Informazione densa", emoji: "📊" },

    // TC-TONE
    { id: "tone:formal-professional", category: "tone", label: "Formale professionale", emoji: "📎" },
    { id: "tone:friendly-casual", category: "tone", label: "Amichevole casual", emoji: "😊" },
    { id: "tone:authoritative-expert", category: "tone", label: "Autorevole esperto", emoji: "🎓" },
    { id: "tone:playful-irreverent", category: "tone", label: "Giocoso irreverente", emoji: "😜" },
    { id: "tone:inspirational", category: "tone", label: "Ispirante", emoji: "✨" },
    { id: "tone:technical-precise", category: "tone", label: "Tecnico preciso", emoji: "🔬" },

    // TC-REFERENCE
    { id: "ref:apple-like", category: "reference", label: "Apple-style", emoji: "🍎" },
    { id: "ref:stripe-like", category: "reference", label: "Stripe-style", emoji: "💳" },
    { id: "ref:notion-like", category: "reference", label: "Notion-style", emoji: "📝" },
    { id: "ref:airbnb-like", category: "reference", label: "Airbnb-style", emoji: "🏡" },
    { id: "ref:dieter-rams", category: "reference", label: "Dieter Rams", emoji: "📐" },
    { id: "ref:swiss-design", category: "reference", label: "Swiss Design", emoji: "🇨🇭" },
    { id: "ref:japanese-minimal", category: "reference", label: "Japanese Minimal", emoji: "⛩️" },

    // TC-FEATURE
    { id: "feat:contact-form", category: "feature", label: "Form contatto", emoji: "📬" },
    { id: "feat:pricing-table", category: "feature", label: "Tabella prezzi", emoji: "💰" },
    { id: "feat:testimonials", category: "feature", label: "Testimonials", emoji: "⭐" },
    { id: "feat:image-gallery", category: "feature", label: "Galleria immagini", emoji: "🖼️" },
    { id: "feat:video-hero", category: "feature", label: "Video hero", emoji: "🎬" },
    { id: "feat:social-feed", category: "feature", label: "Social feed", emoji: "📱" },
    { id: "feat:newsletter-signup", category: "feature", label: "Newsletter", emoji: "📧" },
    { id: "feat:faq-accordion", category: "feature", label: "FAQ accordion", emoji: "❓" },
    { id: "feat:team-section", category: "feature", label: "Sezione team", emoji: "👥" },
    { id: "feat:portfolio-grid", category: "feature", label: "Portfolio grid", emoji: "🗂️" },

    // TC-ERA (visual era / movement reference)
    { id: "era:art-deco", category: "era", label: "Art Déco", emoji: "🔷", description: "Anni '20–'30, geometrie, lusso" },
    { id: "era:bauhaus", category: "era", label: "Bauhaus", emoji: "⬛", description: "Funzionalismo, tipografia industriale" },
    { id: "era:retro-80s", category: "era", label: "Retro '80s", emoji: "📼", description: "Neon, pattern a griglia, Memphis" },
    { id: "era:steampunk", category: "era", label: "Steampunk", emoji: "⚙️", description: "Vittoriano + tecnologia analogica" },
    { id: "era:victorian", category: "era", label: "Vittoriano", emoji: "🎩", description: "Ornamenti floreali, eleganza 1800" },
    { id: "era:memphis", category: "era", label: "Memphis", emoji: "🔴", description: "Pattern geometrici vivaci anni '80" },
    { id: "era:swiss-intl", category: "era", label: "Swiss International", emoji: "🇨🇭", description: "Modernismo tipografico, griglia rigida" },
    { id: "era:japandi", category: "era", label: "Japandi", emoji: "🌿", description: "Fusione wabi-sabi e scandi minimalism" },
    { id: "era:floral-botanical", category: "era", label: "Botanico Floreale", emoji: "🌸", description: "Illustrazioni naturalistiche, palette verde" },
    { id: "era:y2k", category: "era", label: "Y2K / Cyber", emoji: "💿", description: "Estetica fine anni '90 / 2000" },
];

/** Get all tags for a specific category. */
export function getTagsByCategory(category: TagCategory): StyleTagDefinition[] {
    return STYLE_TAG_CATALOG.filter((t) => t.category === category);
}

/** Get a tag by its full id (e.g. "visual:minimal"). */
export function getTagById(id: string): StyleTagDefinition | undefined {
    return STYLE_TAG_CATALOG.find((t) => t.id === id);
}

/** All valid tag IDs as a Set — for fast validation. */
export const VALID_TAG_IDS = new Set(STYLE_TAG_CATALOG.map((t) => t.id));

/** Max tags allowed per category. */
export const MAX_TAGS_PER_CATEGORY = 5;
