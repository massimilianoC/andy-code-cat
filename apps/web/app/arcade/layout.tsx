import type { Viewport } from "next";
import type { ReactNode } from "react";

/**
 * The Arcade is a console screen: edge to edge under notches, no pinch or double-tap zoom while
 * playing, and the console's own dark colour in the browser chrome.
 */
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: "#07071a",
};

export default function ArcadeLayout({ children }: { children: ReactNode }) {
    return children;
}
