/**
 * imageUrlResolver — async post-processing pass on generated HTML artifacts.
 *
 * Finds all image placeholder URLs emitted by the LLM (LoremFlickr or Picsum seeded)
 * and replaces them with real images resolved via the API connector chain:
 *   Pexels → Pixabay → Unsplash → LoremFlickr → Picsum
 *
 * Keys are sourced in this order:
 *   1. MongoDB ServiceApiKey (admin-managed, passed via keyRepo)
 *   2. Environment variables (PEXELS_API_KEY, PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY)
 *   3. LoremFlickr (always available, no key required)
 *
 * Both URL patterns encode keyword + dimensions, so extraction is lossless:
 *   https://loremflickr.com/{W}/{H}/{keyword}
 *   https://picsum.photos/seed/{keyword}/{W}/{H}
 *
 * Unique (keyword, W, H) triples are resolved in parallel to minimise latency.
 * On any connector error the original placeholder URL is preserved (safe fallback).
 */

import { resolveImage } from "../../infra/image/ImageServiceOrchestrator";
import type { ServiceApiKeyRepository } from "../../domain/repositories/ServiceApiKeyRepository";
import type { ImageKeyOverrides } from "../../infra/image/ImageServiceOrchestrator";

// LoremFlickr placeholder: loremflickr.com/{W}/{H}/{keyword}
const LOREMFLICKR_RE = /https:\/\/loremflickr\.com\/(\d+)\/(\d+)\/([^/"'\s&?]+)/g;
// Picsum seeded placeholder: picsum.photos/seed/{keyword}/{W}/{H}
const PICSUM_SEED_RE = /https:\/\/picsum\.photos\/seed\/([^/"'\s]+)\/(\d+)\/(\d+)/g;

interface ResolveTuple {
    keyword: string;
    width: number;
    height: number;
}

function extractPlaceholders(html: string): ResolveTuple[] {
    const tuples: ResolveTuple[] = [];
    const seen = new Set<string>();

    for (const m of html.matchAll(LOREMFLICKR_RE)) {
        const key = `${m[3]}:${m[1]}:${m[2]}`;
        if (!seen.has(key)) {
            seen.add(key);
            tuples.push({ keyword: decodeURIComponent(m[3]), width: Number(m[1]), height: Number(m[2]) });
        }
    }
    for (const m of html.matchAll(PICSUM_SEED_RE)) {
        const key = `${m[1]}:${m[2]}:${m[3]}`;
        if (!seen.has(key)) {
            seen.add(key);
            tuples.push({ keyword: decodeURIComponent(m[1]), width: Number(m[2]), height: Number(m[3]) });
        }
    }
    return tuples;
}

/** Resolve admin-managed keys from MongoDB; falls back gracefully on errors. */
async function resolveDbKeys(keyRepo: ServiceApiKeyRepository): Promise<ImageKeyOverrides> {
    const overrides: ImageKeyOverrides = {};
    const services = ["pexels", "pixabay", "unsplash"] as const;
    await Promise.all(
        services.map(async (svc) => {
            try {
                const entry = await keyRepo.findActiveByService(svc);
                if (entry) {
                    overrides[svc] = await keyRepo.resolvePlaintext(entry);
                }
            } catch {
                // leave undefined — orchestrator falls back to env
            }
        }),
    );
    return overrides;
}

/**
 * Resolve all image placeholder URLs in `html` via the API connector chain.
 * Pass `keyRepo` to use admin-managed keys from MongoDB.
 */
export async function resolveImagesInHtml(
    html: string,
    keyRepo?: ServiceApiKeyRepository,
): Promise<string> {
    const placeholders = extractPlaceholders(html);
    if (placeholders.length === 0) return html;

    const keyOverrides: ImageKeyOverrides = keyRepo ? await resolveDbKeys(keyRepo) : {};

    // Resolve all unique (keyword, W, H) in parallel
    const resolved = new Map<string, string>();
    await Promise.all(
        placeholders.map(async ({ keyword, width, height }) => {
            const mapKey = `${keyword}:${width}:${height}`;
            try {
                const result = await resolveImage({ query: keyword, width, height }, keyOverrides);
                resolved.set(mapKey, result.url);
                console.info(`[imageResolver] "${keyword}" → ${result.url.slice(0, 70)} (${result.attribution ?? result.url.slice(0, 30)})`);
            } catch (err) {
                console.warn(`[imageResolver] failed for "${keyword}":`, err instanceof Error ? err.message : String(err));
                // keep original on error
            }
        }),
    );

    // Substitute LoremFlickr placeholders
    let out = html.replace(LOREMFLICKR_RE, (_match, w, h, kw) => {
        const mapKey = `${decodeURIComponent(kw)}:${w}:${h}`;
        return resolved.get(mapKey) ?? _match;
    });

    // Substitute Picsum seed placeholders
    out = out.replace(PICSUM_SEED_RE, (_match, kw, w, h) => {
        const mapKey = `${decodeURIComponent(kw)}:${w}:${h}`;
        return resolved.get(mapKey) ?? _match;
    });

    return out;
}

