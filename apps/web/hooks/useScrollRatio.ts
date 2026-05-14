"use client";

import { useEffect, useState } from "react";

/**
 * Returns a ratio in [0, 1] that represents scroll progress
 * between `startPx` and `endPx` scroll positions.
 *
 * - ratio = 0 when scrollY <= startPx
 * - ratio = 1 when scrollY >= endPx
 * - linear interpolation in between
 */
export function useScrollRatio(startPx: number, endPx: number): number {
    const [ratio, setRatio] = useState(0);

    useEffect(() => {
        function handleScroll() {
            const y = window.scrollY;
            if (y <= startPx) {
                setRatio(0);
            } else if (y >= endPx) {
                setRatio(1);
            } else {
                setRatio((y - startPx) / (endPx - startPx));
            }
        }

        window.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll(); // seed on mount
        return () => window.removeEventListener("scroll", handleScroll);
    }, [startPx, endPx]);

    return ratio;
}
