"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknotesIcon,
  ClockIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { KreditoIdentityCard, PageHeader } from "~~/components/kredito";
import { BorrowSection } from "~~/components/kredito/BorrowSection";
import { CertificateSection } from "~~/components/kredito/CertificateSection";
import { EvaluationsSection } from "~~/components/kredito/EvaluationsSection";
import { LiquidityDashboard } from "~~/components/kredito/LiquidityDashboard";
import { ProfileSection } from "~~/components/kredito/ProfileSection";
import { ZERO_ADDR } from "~~/components/kredito/flowBits";
import type { StoredScore } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import type { SignedAttestation } from "~~/kredito/vault";
import type { EnsIdentity } from "~~/lib/kredito";
import type { RiskTier } from "~~/services/lendsignal/types";
import { notification } from "~~/utils/scaffold-eth";

type Tab = "overview" | "borrow" | "evaluations" | "profile" | "liquidity";

const TABS: Tab[] = ["overview", "borrow", "evaluations", "profile", "liquidity"];

const NAV: { key: Tab; label: string; icon: typeof BanknotesIcon }[] = [
  { key: "overview", label: "Overview", icon: ShieldCheckIcon },
  { key: "borrow", label: "Borrow", icon: BanknotesIcon },
  { key: "evaluations", label: "My evaluations", icon: ClockIcon },
  { key: "profile", label: "Edit profile", icon: UserCircleIcon },
  { key: "liquidity", label: "Provide liquidity", icon: BanknotesIcon },
];

const isTab = (v: string | null): v is Tab => v !== null && (TABS as string[]).includes(v);

// Map the stored API risk tier string back to the StoredScore RiskTier union so the re-sign route
// can reconstruct a minimal score from a historic credit_check.
const toRiskTier = (tier: string | null | undefined): RiskTier => {
  if (tier === "low_default_risk" || tier === "medium_default_risk" || tier === "high_default_risk") return tier;
  return "high_default_risk";
};

/**
 * The verified-wallet hub. A wallet only ever reaches this once it OWNS a minted
 * <label>.kredito.eth identity, so Borrow/repay are reachable by construction. Tabs:
 *   Overview · Borrow · My evaluations · Edit profile · Provide liquidity
 * Borrow needs a freshly-signed attestation; if none is in state we route the user
 * through the (cheap) Certificate attestation step, reconstructing a minimal score from
 * their latest stored evaluation, then drop them back into Borrow.
 */
export const Dashboard = ({ identity }: { identity: EnsIdentity }) => {
  const { address } = useKreditoWallet();
  const borrower = (address ?? ZERO_ADDR) as `0x${string}`;

  // Reflect the active tab in ?tab= so refresh/back works, without pulling in useSearchParams
  // (which would force a Suspense boundary). Read once on mount; push on change.
  const [tab, setTabState] = useState<Tab>("overview");
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (isTab(param)) setTabState(param);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  };

  const [att, setAtt] = useState<SignedAttestation | null>(null);
  // The Borrow tab requires a signed attestation. When absent, we flip into a re-sign sub-view.
  const [reSigning, setReSigning] = useState(false);
  const [reSignScore, setReSignScore] = useState<StoredScore | null>(null);
  const [loadingScore, setLoadingScore] = useState(false);

  // Reconstruct a minimal StoredScore from the wallet's most recent stored evaluation, so the
  // CertificateSection's "Sign credit attestation" works for a returning verified wallet that has
  // no in-memory score. The attest API only consumes score/riskTier/evidenceDigest, so this is enough.
  const startReSign = async () => {
    if (reSignScore) {
      setReSigning(true);
      return;
    }
    setLoadingScore(true);
    try {
      const listRes = await fetch(`/api/lendsignal/checks?limit=1&borrower=${borrower}`);
      const listJson = await listRes.json();
      const latest = (listJson.checks ?? [])[0] as { inference_id?: string } | undefined;
      if (!latest?.inference_id) {
        notification.error("No prior evaluation found to attest. Run a credit check first.");
        return;
      }
      const detRes = await fetch(
        `/api/lendsignal/evaluation?inferenceId=${encodeURIComponent(latest.inference_id)}&borrower=${borrower}`,
      );
      const det = await detRes.json();
      if (!detRes.ok) throw new Error(det?.error || "Could not load your evaluation.");
      const c = det.check as {
        combined_score: number | null;
        risk_tier: string | null;
        attestation_hash: string | null;
        evidence_digest: string | null;
        eligible: boolean | null;
        model: string | null;
        inference_id: string;
      };
      if (!c.evidence_digest || !c.attestation_hash) {
        notification.error("Your latest evaluation is missing onchain digests — re-run a credit check to borrow.");
        return;
      }
      // Build only the fields CertificateSection + the attest API read.
      const minimal = {
        inferenceId: c.inference_id,
        model: c.model ?? "",
        attested: true,
        combinedScore: c.combined_score ?? 0,
        riskTier: toRiskTier(c.risk_tier),
        eligible: !!c.eligible,
        minEligibleScore: 400,
        scoreInputs: {
          confidentialAiScore: c.combined_score ?? 0,
          attestationHash: c.attestation_hash as `0x${string}`,
          evidenceDigest: c.evidence_digest as `0x${string}`,
          expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        },
      } as unknown as StoredScore;
      setReSignScore(minimal);
      setReSigning(true);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Could not start the attestation.");
    } finally {
      setLoadingScore(false);
    }
  };

  // Reset the re-sign sub-view when leaving the Borrow tab.
  useEffect(() => {
    if (tab !== "borrow") setReSigning(false);
  }, [tab]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-5 py-8 w-full">
      {/* Tab nav — flat free-jump pill row (distinct from the gated wizard stepper). */}
      <div className="k-card p-2 mb-6 relative">
        <div className="flex items-center gap-1 overflow-x-auto">
          {NAV.map(n => {
            const active = tab === n.key;
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => setTab(n.key)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                  active ? "bg-primary text-primary-content" : "hover:bg-base-200 text-base-content/80"
                }`}
              >
                <n.icon className="h-4 w-4" aria-hidden="true" />
                {n.label}
              </button>
            );
          })}
        </div>
        {/* fade cue that more tabs exist when the row scrolls on small screens */}
        <div className="pointer-events-none absolute inset-y-2 right-2 w-8 bg-gradient-to-l from-base-100 to-transparent rounded-r-lg md:hidden" />
      </div>

      {tab === "overview" && (
        <>
          <PageHeader
            eyebrow="Credit identity"
            title="Your dashboard"
            subtitle="Your verified kredito.eth credit identity is live. Borrow against it, review your assessments, update your public profile, or provide liquidity."
          />
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
            <KreditoIdentityCard
              identity={{
                label: identity.label,
                full_name: identity.full_name,
                status: identity.status,
                display_name: identity.display_name,
                description: identity.description,
                avatar_url: identity.avatar_url,
                header_url: identity.header_url,
                url: identity.url,
                location: identity.location,
                twitter: identity.twitter,
                github: identity.github,
                telegram: identity.telegram,
                discord: identity.discord,
                linkedin: identity.linkedin,
                email: identity.email,
                attestation_hash: identity.attestation_hash,
              }}
            />
            {/* Concise status summary — no duplicate of the tab row above. */}
            <div className="k-card p-5 sm:p-6 space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <p className="k-eyebrow mb-1">Credit identity</p>
                  <p className="k-mono text-lg font-semibold truncate">{identity.label}.kredito.eth</p>
                </div>
                <div>
                  <p className="k-eyebrow mb-1">Status</p>
                  <span className="badge badge-success gap-1.5">
                    <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> Verified · Approved
                  </span>
                </div>
              </div>

              <div>
                <p className="k-eyebrow mb-2">What you can do</p>
                <ul className="divide-y divide-base-300 rounded-field border border-base-300">
                  <li>
                    <button
                      type="button"
                      onClick={() => setTab("borrow")}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-base-200 transition-colors"
                    >
                      <BanknotesIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                      <span className="text-sm">Borrow working capital against your attestation</span>
                      <ArrowRightIcon className="ml-auto h-4 w-4 text-base-content/40 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setTab("evaluations")}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-base-200 transition-colors"
                    >
                      <ClockIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                      <span className="text-sm">Review your credit checks and TEE proofs</span>
                      <ArrowRightIcon className="ml-auto h-4 w-4 text-base-content/40 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setTab("profile")}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-base-200 transition-colors"
                    >
                      <UserCircleIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                      <span className="text-sm">Edit your public credit-identity profile</span>
                      <ArrowRightIcon className="ml-auto h-4 w-4 text-base-content/40 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "borrow" &&
        (reSigning && reSignScore ? (
          <>
            <button className="btn btn-ghost btn-sm gap-1 mb-4" type="button" onClick={() => setReSigning(false)}>
              <ArrowLeftIcon className="h-4 w-4" /> Back to borrow
            </button>
            <CertificateSection
              result={reSignScore}
              borrower={borrower}
              legalName={identity.label}
              att={att}
              setAtt={setAtt}
              onMinted={() => {}}
              onBack={() => setReSigning(false)}
              onNext={() => setReSigning(false)}
              alreadyMinted
              nextLabel="Back to borrow"
            />
          </>
        ) : (
          <BorrowSection
            result={null}
            borrower={borrower}
            att={att}
            embedded
            onReSign={() => {
              if (loadingScore) return;
              void startReSign();
            }}
          />
        ))}

      {tab === "evaluations" && <EvaluationsSection borrower={borrower} onStartEvaluation={() => setTab("borrow")} />}

      {tab === "profile" && <ProfileSection borrower={borrower} mintedLabel={identity.label} embedded />}

      {tab === "liquidity" && <LiquidityDashboard borrower={borrower} embedded />}
    </div>
  );
};
