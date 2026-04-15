import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { capturePageview } from "./analytics";

/** Sends PostHog `$pageview` on hash-route changes (capture_pageview is off in init). */
export function PostHogPageviews() {
  const location = useLocation();

  useEffect(() => {
    capturePageview();
  }, [location.pathname, location.search, location.key]);

  return null;
}
