"use client";

import { useCallback, useEffect, useState } from "react";
import { TELOS as FALLBACK, type Telos } from "./data";

export function useTelosData(): { telos: Telos | null; refetch: () => void; error: string | null } {
  const [telos, setTelos] = useState<Telos>(FALLBACK);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<number>(0);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    fetch("/api/telos/overview")
      .then((r) => r.json())
      .then((live) => {
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

  return { telos, refetch, error };
}
