"use client";

import { Panel, RiskBadge } from "~~/components/kredito";
import { apiTierToRiskTier } from "~~/components/kredito/flowBits";
import { useCreditChecks } from "~~/kredito/useCreditChecks";

/**
 * The connected wallet's recent credit checks, read back from Supabase. Hides
 * itself when Supabase isn't configured, so it never shows a broken state.
 */
export const RecentChecks = ({ borrower }: { borrower?: string }) => {
  const { checks, configured } = useCreditChecks(borrower, 8);

  // Loading, or Supabase not set up → render nothing.
  if (checks === null || !configured) return null;

  return (
    <Panel eyebrow="History" title="Your recent checks" className="mt-5">
      {checks.length === 0 ? (
        <p className="text-sm text-base-content/55">No checks stored yet — run your first credit check above.</p>
      ) : (
        <div className="divide-y divide-base-300">
          {checks.map(c => {
            const tier = apiTierToRiskTier(c.risk_tier);
            return (
              <div key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="k-mono text-xs text-base-content/55 w-32 shrink-0">
                  {new Date(c.created_at).toLocaleString()}
                </span>
                <span className="k-mono font-semibold tabular-nums w-10 shrink-0">{c.combined_score ?? "—"}</span>
                {tier ? (
                  <RiskBadge tier={tier} size="sm" />
                ) : (
                  <span className="badge badge-sm badge-ghost shrink-0">—</span>
                )}
                <code className="k-mono text-xs text-base-content/50 truncate flex-1">{c.inference_id}</code>
                {c.attested && <span className="badge badge-ghost badge-sm shrink-0">TEE</span>}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
};
