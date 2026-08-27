"use client";

import { useEffect, useState } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * WHY THIS EXISTS RATHER THAN A TAILWIND CLASS. Showing and hiding with
 * `lg:hidden` renders BOTH versions and lets CSS pick — which is right for
 * markup and wrong for a camera. Two mounted scanners would open two video
 * streams, and the second `getUserMedia` either fails or steals the first's
 * track. Some things must exist once, and the component has to know which one
 * it is.
 *
 * STARTS FALSE ON BOTH SERVER AND CLIENT, then corrects in an effect. Reading
 * `matchMedia` during render would make the server's HTML differ from the
 * browser's first paint, which React reports as a hydration mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Below Tailwind's `lg`, which is where the bottom tab bar takes over. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
