"use client";

import { useEffect } from "react";

/**
 * Registers the service worker so the app is installable and opens offline.
 *
 * Development is skipped deliberately — a cached shell during `next dev` means
 * edits appear at random, which costs more time than offline support saves.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing just means no offline mode; the app still works.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
