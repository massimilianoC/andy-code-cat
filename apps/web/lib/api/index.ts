/**
 * Public barrel re-export.
 * Consumers use `import { ... } from '@/lib/api'` unchanged.
 */
export * from "./auth";
export * from "./projects";
export * from "./assets";
export * from "./conversations";
export * from "./llm";
export * from "./snapshots";
export * from "./exports";
export * from "./wysiwyg";
export * from "./logs";
export * from "./health";
export * from "./publish";
export * from "./user";
// ApiError is part of the public surface
export { ApiError } from "./call";
