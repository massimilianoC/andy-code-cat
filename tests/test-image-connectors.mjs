/**
 * tests/test-image-connectors.mjs
 *
 * End-to-end smoke test for the image connector chain.
 * Reads API keys directly from .env.docker (no Docker / no compiled TS required).
 *
 * Usage:
 *   node tests/test-image-connectors.mjs
 *
 * Exit codes:
 *   0 — all connectors with keys present returned a valid URL
 *   1 — at least one connector with a key present returned an error
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── Load .env.docker ─────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env.docker");

let rawEnv;
try {
    rawEnv = readFileSync(envPath, "utf8");
} catch {
    console.error(`\n[SKIP] .env.docker not found at ${envPath} — run from repo root`);
    process.exit(0);
}

function parseEnvFile(raw) {
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return out;
}

const envVars = parseEnvFile(rawEnv);
const PEXELS_KEY    = envVars["PEXELS_API_KEY"]     ?? "";
const PIXABAY_KEY   = envVars["PIXABAY_API_KEY"]    ?? "";
const UNSPLASH_KEY  = envVars["UNSPLASH_ACCESS_KEY"] ?? "";

// ── Connector implementations (mirrored inline — no TS compilation needed) ───

async function searchPexels(query, width, height, apiKey) {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const hit = json.photos?.[0];
    if (!hit) return null;
    const src = width >= 1200 ? hit.src.large2x : width >= 800 ? hit.src.large : hit.src.medium;
    return { url: src, attribution: `Pexels — ${hit.photographer}`, width: hit.width, height: hit.height };
}

async function searchPixabay(query, width, height, apiKey) {
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=3&image_type=photo&orientation=horizontal`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const hit = json.hits?.[0];
    if (!hit) return null;
    const src = width >= 800 ? hit.largeImageURL : hit.webformatURL;
    return { url: src, attribution: `Pixabay — ${hit.user}`, width: hit.imageWidth, height: hit.imageHeight };
}

async function searchUnsplash(query, width, height, apiKey) {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
    if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const hit = json.results?.[0];
    if (!hit) return null;
    const src = width >= 1200 ? hit.urls.full : width >= 600 ? hit.urls.regular : hit.urls.small;
    return { url: src, attribution: `Unsplash — ${hit.user.name}`, width: hit.width, height: hit.height };
}

function searchLoremFlickr(query, width, height) {
    const keyword = encodeURIComponent(query.split(" ")[0] ?? "nature");
    return { url: `https://loremflickr.com/${width}/${height}/${keyword}`, attribution: "LoremFlickr (Flickr CC0)", width, height };
}

async function resolveImage(query, width, height, keyOverrides = {}) {
    const pexelsKey   = keyOverrides.pexels   ?? PEXELS_KEY;
    const pixabayKey  = keyOverrides.pixabay  ?? PIXABAY_KEY;
    const unsplashKey = keyOverrides.unsplash ?? UNSPLASH_KEY;

    if (pexelsKey) {
        try { const r = await searchPexels(query, width, height, pexelsKey); if (r) return { ...r, engine: "Pexels" }; }
        catch (e) { console.warn(`  [WARN] Pexels error: ${e.message}`); }
    }
    if (pixabayKey) {
        try { const r = await searchPixabay(query, width, height, pixabayKey); if (r) return { ...r, engine: "Pixabay" }; }
        catch (e) { console.warn(`  [WARN] Pixabay error: ${e.message}`); }
    }
    if (unsplashKey) {
        try { const r = await searchUnsplash(query, width, height, unsplashKey); if (r) return { ...r, engine: "Unsplash" }; }
        catch (e) { console.warn(`  [WARN] Unsplash error: ${e.message}`); }
    }
    return { ...searchLoremFlickr(query, width, height), engine: "LoremFlickr (fallback, no key)" };
}

// ── Test cases ────────────────────────────────────────────────────────────────

const QUERIES = [
    { query: "modern office interior",     width: 1200, height: 600 },
    { query: "technology circuit board",   width: 800,  height: 450 },
    { query: "nature mountain landscape",  width: 800,  height: 600 },
    { query: "urban city skyline night",   width: 1200, height: 800 },
];

// ── Per-connector tests ───────────────────────────────────────────────────────

async function testConnector(name, fn, key) {
    if (!key) {
        console.log(`  [SKIP] ${name}: no API key in .env.docker`);
        return "skip";
    }
    try {
        const result = await fn();
        if (!result) {
            console.log(`  [WARN] ${name}: returned null (no results for this query)`);
            return "warn";
        }
        const short = result.url.length > 80 ? result.url.slice(0, 77) + "…" : result.url;
        console.log(`  [OK]   ${name}: ${short}`);
        console.log(`         attribution: ${result.attribution ?? "—"}`);
        return "ok";
    } catch (e) {
        console.error(`  [FAIL] ${name}: ${e.message}`);
        return "fail";
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" Image Connector Chain — End-to-End Smoke Test");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`\nKeys present in .env.docker:`);
console.log(`  PEXELS_API_KEY     : ${PEXELS_KEY   ? "✓ present (" + PEXELS_KEY.slice(0,8) + "…)" : "✗ missing"}`);
console.log(`  PIXABAY_API_KEY    : ${PIXABAY_KEY  ? "✓ present (" + PIXABAY_KEY.slice(0,8) + "…)" : "✗ missing"}`);
console.log(`  UNSPLASH_ACCESS_KEY: ${UNSPLASH_KEY ? "✓ present (" + UNSPLASH_KEY.slice(0,8) + "…)" : "✗ missing"}`);

let failures = 0;

// ── Section 1: individual connector tests ────────────────────────────────────
console.log("\n─── Section 1: individual connectors ───────────────────────────");
const testQuery = "technology digital abstract";
const [w, h] = [1200, 600];

const r1 = await testConnector("Pexels",    () => searchPexels(testQuery, w, h, PEXELS_KEY),     PEXELS_KEY);
const r2 = await testConnector("Pixabay",   () => searchPixabay(testQuery, w, h, PIXABAY_KEY),   PIXABAY_KEY);
const r3 = await testConnector("Unsplash",  () => searchUnsplash(testQuery, w, h, UNSPLASH_KEY), UNSPLASH_KEY);
const r4 = await testConnector("LoremFlickr (no key)", () => searchLoremFlickr(testQuery, w, h), "always");

if (r1 === "fail") failures++;
if (r2 === "fail") failures++;
if (r3 === "fail") failures++;

// ── Section 2: full fallback chain test ───────────────────────────────────────
console.log("\n─── Section 2: full chain (resolveImage) for semantic queries ──");
for (const { query, width, height } of QUERIES) {
    console.log(`\n  Query: "${query}" (${width}×${height})`);
    try {
        const result = await resolveImage(query, width, height);
        const short = result.url.length > 80 ? result.url.slice(0, 77) + "…" : result.url;
        console.log(`  → Engine  : ${result.engine}`);
        console.log(`  → URL     : ${short}`);
        console.log(`  → Credit  : ${result.attribution ?? "—"}`);
    } catch (e) {
        console.error(`  [FAIL] resolveImage error: ${e.message}`);
        failures++;
    }
}

// ── Section 3: imageUrlRewriter simulation ────────────────────────────────────
console.log("\n─── Section 3: HTML post-processing simulation ─────────────────");
const sampleHtml = `
<section>
  <img src="https://loremflickr.com/1200/600/office" alt="office">
  <img src="https://picsum.photos/seed/technology/800/450" alt="tech">
  <img src="https://loremflickr.com/800/500/nature" alt="nature">
</section>`;

console.log("\n  Input HTML (LLM placeholder output):");
for (const line of sampleHtml.trim().split("\n")) console.log("    " + line);

// Extract all placeholder URLs
const LF_RE = /https:\/\/loremflickr\.com\/(\d+)\/(\d+)\/([^"'\s&?]+)/g;
const PS_RE = /https:\/\/picsum\.photos\/seed\/([^"'\s]+)\/(\d+)\/(\d+)/g;

const placeholders = [];
for (const m of sampleHtml.matchAll(LF_RE))
    placeholders.push({ keyword: m[3], width: Number(m[1]), height: Number(m[2]), original: m[0] });
for (const m of sampleHtml.matchAll(PS_RE))
    placeholders.push({ keyword: m[1], width: Number(m[2]), height: Number(m[3]), original: m[0] });

let resolvedHtml = sampleHtml;
console.log(`\n  Resolving ${placeholders.length} placeholder(s)...`);

for (const { keyword, width, height, original } of placeholders) {
    try {
        const result = await resolveImage(keyword, width, height);
        console.log(`  [${result.engine}] ${keyword} → ${result.url.slice(0, 70)}…`);
        resolvedHtml = resolvedHtml.replace(original, result.url);
    } catch (e) {
        console.warn(`  [WARN] could not resolve "${keyword}": ${e.message}`);
    }
}

console.log("\n  Output HTML (with real image URLs):");
for (const line of resolvedHtml.trim().split("\n")) console.log("    " + line);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
if (failures === 0) {
    console.log(` RESULT: ALL TESTS PASSED`);
} else {
    console.log(` RESULT: ${failures} FAILURE(S) DETECTED`);
}
console.log("═══════════════════════════════════════════════════════════════\n");

process.exit(failures > 0 ? 1 : 0);
