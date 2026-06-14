"use client";

import { useEffect, useState } from "react";
import { Panel } from "~~/components/kredito";

type StoredCheck = {
  id: string;
  created_at: string;
  inference_id: string;
  model: string | null;
  attested: boolean;
  combined_score: number | null;
  risk_tier: string | null;
  eligible: boolean | null;
};

const TIER_LABEL: Record<string, string> = {
  low_default_risk: "Low",
  medium_default_risk: "Medium",
  high_default_risk: "High",
};
const TIER_BADGE: Record<string, string> = {
  low_default_risk: "badge-success",
  medium_default_risk: "badge-warning",
  high_default_risk: "badge-error",
};

/**
 * The connected wallet's recent credit checks, read back from Supabase. Hides
 * itself when Supabase isn't configured, so it never shows a broken state.
 */
export const RecentChecks = ({ borrower }: { borrower?: string }) => {
  const [checks, setChecks] = useState<StoredCheck[] | null>(null);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    let active = true;
    const url = `/api/lendsignal/checks?limit=8${borrower ? `&borrower=${borrower}` : ""}`;
    fetch(url)
      .then(r => r.json())
      .then(j => {
        if (!active) return;
        setConfigured(j.configured !== false);
        setChecks(j.checks ?? []);
      })
      .catch(() => active && setChecks([]));
    return () => {
      active = false;
    };
  }, [borrower]);

  // Loading, or Supabase not set up → render nothing.
  if (checks === null || !configured) return null;

  return (
    <Panel eyebrow="History" title="Your recent checks" className="mt-5">
      {checks.length === 0 ? (
        <p className="text-sm text-base-content/55">No checks stored yet — run your first credit check above.</p>
      ) : (
        <div className="divide-y divide-base-300">
          {checks.map(c => (
            <div key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="k-mono text-xs text-base-content/55 w-32 shrink-0">
                {new Date(c.created_at).toLocaleString()}
              </span>
              <span className="k-mono font-semibold w-10 shrink-0">{c.combined_score ?? "—"}</span>
              <span className={`badge badge-sm ${c.risk_tier ? TIER_BADGE[c.risk_tier] : "badge-ghost"}`}>
                {c.risk_tier ? TIER_LABEL[c.risk_tier] : "—"}
              </span>
              <code className="k-mono text-xs text-base-content/50 truncate flex-1">{c.inference_id}</code>
              {c.attested && <span className="badge badge-ghost badge-sm shrink-0">TEE</span>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
