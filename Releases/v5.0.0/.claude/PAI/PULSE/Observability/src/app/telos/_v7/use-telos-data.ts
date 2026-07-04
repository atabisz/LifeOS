"use client";

import { useCallback, useEffect, useState } from "react";
import { TELOS as FALLBACK, type Telos } from "./data";

export function useTelosData(): { telos: Telos | null; refetch: () => void; error: string | null; isPersonalized: boolean } {
  const [telos, setTelos] = useState<Telos>(FALLBACK);
  const [error, setError] = useState<string | null>(null);
  const [isPersonalized, setIsPersonalized] = useState<boolean>(false);
  const [version, setVersion] = useState<number>(0);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    fetch("/api/telos/overview")
      .then((r) => r.json())
      .then((live) => {
        // Authoritative personalization signal from the backend (computed over
        // REAL parsed data, not this fallback-merged view). Consumers gate
        // fixture-sensitive rendering (e.g. the analysis summary) on this so a
        // fresh install never has sample data analyzed as if it were real.
        setIsPersonalized(live?.meta?.isPersonalized === true);
        // Merge live data over fallback — only replace fields that the API actually populated
        const merged: Telos = { ...FALLBACK };
        for (const key of Object.keys(live) as (keyof Telos)[]) {
          const val = live[key];
          if (val !== null && val !== undefined && !(Array.isArray(val) && val.length === 0)) {
            (merged as any)[key] = val;
          }
        }
        setTelos(merged);
      })
      .catch((err) => setError(String(err)));
  }, [version]);

  return { telos, refetch, error, isPersonalized };
}
