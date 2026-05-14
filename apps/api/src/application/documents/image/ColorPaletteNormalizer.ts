const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const CHANNEL_PROXIMITY = 15;
const MAX_COLORS = 5;

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function saturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    if (max === 0) return 0;
    return (max - min) / max;
}

function isCloseTo(a: [number, number, number], b: [number, number, number]): boolean {
    return (
        Math.abs(a[0] - b[0]) < CHANNEL_PROXIMITY &&
        Math.abs(a[1] - b[1]) < CHANNEL_PROXIMITY &&
        Math.abs(a[2] - b[2]) < CHANNEL_PROXIMITY
    );
}

export function normalizeHexList(rawHex: string[]): string[] {
    const valid = rawHex
        .map(h => h.trim())
        .filter(h => HEX_RE.test(h))
        .map(h => h.toLowerCase());

    const kept: Array<{ hex: string; rgb: [number, number, number]; sat: number }> = [];

    for (const hex of valid) {
        const rgb = hexToRgb(hex);
        const sat = saturation(...rgb);
        const duplicate = kept.find(k => isCloseTo(k.rgb, rgb));
        if (duplicate) {
            if (sat > duplicate.sat) {
                duplicate.hex = hex;
                duplicate.rgb = rgb;
                duplicate.sat = sat;
            }
        } else {
            kept.push({ hex, rgb, sat });
        }
    }

    return kept.slice(0, MAX_COLORS).map(k => k.hex);
}
