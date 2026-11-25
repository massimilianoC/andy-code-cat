// Ambient declarations for npm packages with no published type definitions.
// Both are loaded via dynamic import + runtime cast in their respective parsers
// (RtfParser.ts, LegacyDocParser.ts) — this file only silences TS7016 so the
// cast site remains the single source of truth for the actual shape used.

declare module "rtf-parser";
declare module "word-extractor";
