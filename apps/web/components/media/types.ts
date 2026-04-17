/**
 * Shared types for the reusable MediaGrid component family.
 *
 * These types are intentionally generic so the same grid can render
 * project assets, account images, page-scanned media, gallery items, etc.
 */

/** Supported media categories for filtering. */
export type MediaType = "image" | "video" | "audio" | "background" | "other";

/** A single media entry displayed inside a MediaGrid. */
export interface MediaItem {
    /** Unique stable identifier (used as React key and selection tracking). */
    id: string;
    /** Thumbnail / preview URL. */
    src: string;
    /** Accessible alt text. */
    alt?: string;
    /** Short display label shown below the thumbnail. */
    label?: string;
    /** Category used by built-in type filters. */
    mediaType: MediaType;
    /** Intrinsic width in px (informational). */
    width?: number;
    /** Intrinsic height in px (informational). */
    height?: number;
    /** Arbitrary extra data the consumer can attach (e.g. selector, tag). */
    meta?: Record<string, unknown>;
}

/** A declarative filter chip rendered in the MediaGrid header. */
export interface MediaFilter {
    /** Unique key also used as the query-param / state value. */
    key: string;
    /** Human-readable label for the chip. */
    label: string;
    /** Optional icon rendered before the label. */
    icon?: React.ReactNode;
    /** Return true if the item should be visible when this filter is active. */
    match: (item: MediaItem) => boolean;
}
