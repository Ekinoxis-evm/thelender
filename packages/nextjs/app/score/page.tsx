"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { FlowShell, HashChip, PageHeader, Panel, RiskBadge, ScoreMeter, SignalRow } from "~~/components/kredito";
import { DEMO_CERTIFICATE } from "~~/kredito/mock";
import { type StoredScore, loadScoreResult, toUiRiskTier } from "~~/kredito/scoreStore";

export default function ScorePage() {
  const [result, setResult] = useState<StoredScore | null>(null);
  useEffect(() => setResult(loadScoreResult()), []);

  // Real attested result when present; otherwise the demo certificate so the page
  // still renders if visited directly.
  const view = result
    ? {
        combinedScore: result.combinedScore,
        aiScore: result.scoreInputs.confidentialAiScore,
        bureauScore: result.scoreInputs.bureauScore,
        attestationHash: result.scoreInputs.attestationHash,
        bureauReportHash: result.scoreInputs.bureauReportHash,
        evidenceDigest: result.scoreInputs.evidenceDigest,
        riskTier: toUiRiskTier(result.riskTier),
        eligible: result.eligible,
        attested: result.attested,
        inferenceId: result.inferenceId,
        model: result.model,
        reasoning: result.confidentialAi.reasoning_summary,
        positives: result.bureau.positiveSignals,
        adverse: result.bureau.adverseSignals,
        isReal: true,
      }
    : {
        combinedScore: DEMO_CERTIFICATE.combinedScore,
        aiScore: DEMO_CERTIFICATE.confidentialAiScore,
        bureauScore: DEMO_CERTIFICATE.bureauScore,
        attestationHash: DEMO_CERTIFICATE.attestationHash,
        bureauReportHash: DEMO_CERTIFICATE.bureauReportHash,
        evidenceDigest: DEMO_CERTIFICATE.evidenceDigest,
        riskTier: DEMO_CERTIFICATE.riskTier,
        eligible: DEMO_CERTIFICATE.combinedScore >= 750,
        attested: false,
        inferenceId: "—",
        model: "gemma4",
        reasoning: "",
        positives: [] as string[],
        adverse: [] as string[],
        isReal: false,
      };

  return (
    <FlowShell activeKey="score">
      <PageHeader
        step={2}
        eyebrow="Creditworthiness score"
        title="Two signals, one score"
        subtitle="A Chainlink Confidential AI attestation and a CRS credit-bureau signal are blended onchain into a single 0–1000 score. The weights live in the registry and are owner-tunable."
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel
          eyebrow="Result"
          title="Combined score"
          className="lg:col-span-2"
          action={
            view.attested ? (
              <span className="badge badge-success gap-1">
                <ShieldCheckIcon className="h-3.5 w-3.5" /> Attested (TEE)
              </span>
            ) : view.isReal ? (
              <span className="badge badge-ghost">mock (not attested)</span>
            ) : (
              <span className="badge badge-ghost">demo data</span>
            )
          }
        >
          <ScoreMeter score={view.combinedScore} />

          <div className="mt-7 space-y-5">
            <SignalRow
              name="Confidential AI Attester"
              source="Chainlink · runs in a TEE, returns a structured credit result"
              score={view.aiScore}
              weightBps={7000}
              accent="bg-primary"
            />
            <SignalRow
              name="Credit-risk bureau"
              source="CRS · business credit history, normalized offchain"
              score={view.bureauScore}
              weightBps={3000}
              accent="bg-brand-teal"
            />
          </div>

          <div className="mt-6 rounded-field bg-base-200 px-4 py-3 k-mono text-sm">
            combinedScore = {view.aiScore}·70% + {view.bureauScore}·30% ={" "}
            <span className="font-semibold">{view.combinedScore}</span>
          </div>

          {view.isReal && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-base-content/55">
              <span>
                model <span className="k-mono text-base-content/75">{view.model}</span>
              </span>
              <span>
                request <span className="k-mono text-base-content/75">{view.inferenceId}</span>
              </span>
            </div>
          )}

          {view.reasoning && (
            <div className="mt-4">
              <p className="k-eyebrow mb-1">AI reasoning</p>
              <p className="text-sm text-base-content/70">{view.reasoning}</p>
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel eyebrow="Evidence anchors" title="Onchain hashes">
            <p className="text-sm text-base-content/65 mb-3">
              Raw evidence stays offchain; only these digests are published.
            </p>
            <div className="space-y-2.5">
              <div>
                <p className="k-eyebrow mb-1">Attestation</p>
                <HashChip value={view.attestationHash} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Bureau report</p>
                <HashChip value={view.bureauReportHash} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Evidence digest</p>
                <HashChip value={view.evidenceDigest} />
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Policy" title="Eligibility" action={<RiskBadge tier={view.riskTier} size="sm" />}>
            <div
              className={`rounded-field px-3 py-2 text-sm font-medium mb-3 ${
                view.eligible ? "bg-success/10 text-success" : "bg-error/10 text-error"
              }`}
            >
              {view.eligible ? "Eligible — score ≥ 750" : "Not eligible — below 750 / high risk"}
            </div>
            <ul className="text-sm space-y-1.5 text-base-content/75">
              <li>≥ 750 → Low risk</li>
              <li>600–749 → Medium risk</li>
              <li>&lt; 600 → High risk (rejected)</li>
            </ul>
            <Link href="/certificate" className="btn btn-primary btn-sm mt-4">
              Issue certificate
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Panel>

          {(view.positives.length > 0 || view.adverse.length > 0) && (
            <Panel eyebrow="Bureau" title="Signals">
              {view.positives.length > 0 && (
                <div className="mb-2">
                  <p className="k-eyebrow text-success mb-1">Positive</p>
                  <ul className="text-sm text-base-content/75 list-disc list-inside">
                    {view.positives.map(s => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {view.adverse.length > 0 && (
                <div>
                  <p className="k-eyebrow text-error mb-1">Adverse</p>
                  <ul className="text-sm text-base-content/75 list-disc list-inside">
                    {view.adverse.map(s => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </FlowShell>
  );
}
