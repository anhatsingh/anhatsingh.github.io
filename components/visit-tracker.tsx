"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { logVisit } from "@/app/visit-log";
import { hostOf, resolveSource, type VisitEvent } from "@/lib/analytics/source";

/*
  Where visitors came from, and whether they did anything.

  Built to answer one question a job search actually needs: which channel
  produces conversations, not which produces clicks. Twelve visits from a cold
  email where four open a resume beat a thousand from an aggregator where
  nobody speaks.

  The attribution has to be captured once and carried. UTM tags exist only on
  the landing URL, so by the second page they are gone — a visitor who arrives
  from LinkedIn and then reads three project pages would otherwise file as one
  LinkedIn visit and three direct ones, which is how a working channel comes to
  look like it does nothing.
*/

const STORAGE_KEY = "anhat.visit.v1";

interface Attribution {
  visitId: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  referrerHost: string | null;
}

const VisitContext = createContext<(event: VisitEvent) => void>(() => {});

/** Records something the visitor did. Fire-and-forget from anywhere. */
export function useVisitLog(): (event: VisitEvent) => void {
  return useContext(VisitContext);
}

/*
  A random number per tab session, not a cookie and not a fingerprint.

  This is the one identifier stored anywhere, and it is deliberately the
  weakest kind: generated on arrival, kept in sessionStorage, gone when the tab
  closes, and never derived from anything about the person. It buys exactly one
  thing — telling five pages read by one visitor apart from one page read by
  five — which is the difference between a channel that works and a number
  nobody can act on.
*/
function attribution(): Attribution | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as Attribution;

    const params = new URLSearchParams(window.location.search);
    const fresh: Attribution = {
      visitId: crypto.randomUUID().slice(0, 12),
      source: resolveSource({
        utmSource: params.get("utm_source"),
        referrer: document.referrer,
        selfHost: window.location.hostname,
      }),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      referrerHost: hostOf(document.referrer) || null,
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    // Private browsing, or storage disabled. Nothing here is worth failing a
    // page render over, so the visit simply goes unrecorded.
    return null;
  }
}

export function VisitTracker({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const record = useCallback((event: VisitEvent, path?: string) => {
    // Headless browsers announce themselves, and a crawler's page views would
    // drown the handful of real ones that matter.
    if (typeof navigator !== "undefined" && navigator.webdriver) return;

    const who = attribution();
    if (!who) return;

    void logVisit({
      visitId: who.visitId,
      source: who.source,
      medium: who.medium,
      campaign: who.campaign,
      referrerHost: who.referrerHost,
      path: path ?? window.location.pathname,
      event,
    });
  }, []);

  /*
    One row per page, not per render. React re-runs effects for reasons that
    have nothing to do with navigation, and a page view logged twice makes a
    visitor look twice as interested as they were.
  */
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (seen.current.has(pathname)) return;
    seen.current.add(pathname);
    record("view", pathname);
  }, [pathname, record]);

  return (
    <VisitContext.Provider value={(event) => record(event)}>{children}</VisitContext.Provider>
  );
}
