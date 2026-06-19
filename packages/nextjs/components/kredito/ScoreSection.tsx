"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  DocumentDuplicateIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { HashChip, PageHeader, Panel, RiskBadge, ScoreMeter, SignalRow } from "~~/components/kredito";
import { BAND_BADGE, DECISION_BADGE, DECISION_LABEL, SIGNAL_BADGE } from "~~/components/kredito/flowBits";
import { type StoredScore, toUiRiskTier } from "~~/kredito/scoreStore";
import { notification } from "~~/utils/scaffold-eth";

export const ScoreSection = ({
  result,
  onBack,
  onIssue,
}: {
  result: StoredScore;
  onBack: () => void;
  onIssue: () => void;
}) => {
  const ai = result.scoreInputs.confidentialAiScore;
  const tokens = result.usage ? result.usage.prompt_tokens + result.usage.completion_tokens : undefined;
  const copyId = () => {
    navigator.clipboard?.writeText(result.inferenceId);
    notification.success("Chainlink request ID copied");
  };
  return (
    <>
      <PageHeader
        step={2}
        eyebrow="Creditworthiness score"
        title="Confidential AI credit score"
        subtitle="Your documents are analyzed inside a Chainlink TEE; the attested result is your 0–1000 credit score."
      />
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel
          eyebrow="Result"
          title="Credit score"
          className="lg:col-span-2"
          action={
            result.attested ? (
              <span className="badge badge-success gap-1">
                <ShieldCheckIcon className="h-3.5 w-3.5" /> Attested (TEE)
              </span>
            ) : null
          }
        >
          <ScoreMeter score={result.combinedScore} />
          <div className="mt-7 space-y-5">
            <SignalRow
              name="Confidential AI Attester"
              source="Chainlink · runs in a TEE"
              score={ai}
              weightBps={10000}
              accent="bg-primary"
            />
          </div>
          {result.confidentialAi.reasoning_summary && (
            <div className="mt-4">
              <p className="k-eyebrow mb-1">AI reasoning</p>
              <p className="text-sm text-base-content/70">{result.confidentialAi.reasoning_summary}</p>
            </div>
          )}
          {/* Chainlink Confidential AI — the request id is the on-record proof of the inference */}
          <div className="mt-5 rounded-field border border-primary/30 bg-primary/5 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="k-eyebrow flex items-center gap-1.5">
                <ShieldCheckIcon className="h-4 w-4 text-primary" /> Chainlink request ID
              </p>
              <span className="badge badge-success badge-sm">attested · TEE</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="k-mono text-sm break-all flex-1">{result.inferenceId}</code>
              <a
                href={`/inference/${result.inferenceId}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-xs gap-1 shrink-0"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> View
              </a>
              <button type="button" onClick={copyId} className="btn btn-ghost btn-xs gap-1 shrink-0">
                <DocumentDuplicateIcon className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <p className="mt-1.5 text-xs text-base-content/55">
              model <span className="k-mono">{result.model}</span>
              {tokens !== undefined && (
                <>
                  {" · "}
                  <span className="k-mono">{tokens}</span> tokens
                </>
              )}
            </p>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel
            eyebrow="Evidence anchors"
            title="Onchain-ready digests"
            action={<span className="badge badge-ghost badge-sm">not issued yet</span>}
          >
            <p className="text-xs text-base-content/55 mb-3">
              These digests (the certificate&apos;s <code>ScoreInputs</code>) are written onchain when you issue the
              certificate. Raw evidence stays offchain.
            </p>
            <div className="space-y-2.5">
              <div>
                <p className="k-eyebrow mb-1">Attestation</p>
                <HashChip value={result.scoreInputs.attestationHash} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Evidence digest</p>
                <HashChip value={result.scoreInputs.evidenceDigest} />
              </div>
            </div>
            <a
              href={`/inference/${result.inferenceId}`}
              target="_blank"
              rel="noreferrer"
              className="link text-xs inline-flex items-center gap-1 mt-3"
            >
              Verify the Chainlink attestation
              <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </a>
          </Panel>
          <Panel
            eyebrow="Policy"
            title="Eligibility"
            action={<RiskBadge tier={toUiRiskTier(result.riskTier)} size="sm" />}
          >
            <div
              className={`rounded-field px-3 py-2 text-sm font-medium ${
                result.eligible ? "bg-success/10 text-success" : "bg-error/10 text-error"
              }`}
            >
              {result.eligible
                ? `Eligible — score ≥ ${result.minEligibleScore}`
                : `Not eligible — below ${result.minEligibleScore} / high risk`}
            </div>
          </Panel>
        </div>
      </div>

      {/* All Confidential AI queries that ran (per-section + reduce) */}
      {result.inferences && result.inferences.length > 0 && (
        <Panel eyebrow={`${result.inferences.length} queries`} title="Confidential AI requests" className="mt-5">
          <div className="divide-y divide-base-300">
            {result.inferences.map(q => (
              <div key={q.inferenceId} className="flex items-center gap-3 py-2 text-sm">
                <span className={`badge badge-sm shrink-0 ${q.attested ? "badge-success" : "badge-ghost"}`}>
                  {q.attested ? "TEE" : "—"}
                </span>
                <span className="font-medium w-40 sm:w-48 shrink-0 truncate">{q.label}</span>
                <a
                  href={`/inference/${q.inferenceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link k-mono text-xs truncate flex-1 inline-flex items-center gap-1"
                >
                  {q.inferenceId}
                  <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
                </a>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-base-content/50">
            One attested request per document, plus one for the final decision.
          </p>
        </Panel>
      )}

      {/* Per-document analysis (map) → final decision (reduce) */}
      {result.confidentialAi.document_analysis.length > 0 && (
        <Panel
          eyebrow={`Per document · ${result.confidentialAi.document_analysis.length} analyzed`}
          title="Document analysis"
          className="mt-5"
          action={
            <span className={`badge ${DECISION_BADGE[result.confidentialAi.decision]}`}>
              {DECISION_LABEL[result.confidentialAi.decision]}
            </span>
          }
        >
          <div className="divide-y divide-base-300">
            {result.confidentialAi.document_analysis.map((d, i) => (
              <div key={`${d.filename}-${i}`} className="py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge badge-sm ${SIGNAL_BADGE[d.signal]}`}>{d.signal}</span>
                  <span className="font-medium text-sm">{d.documentType}</span>
                  <code className="k-mono text-xs text-base-content/45">{d.filename}</code>
                  {!d.reliable && <span className="badge badge-error badge-sm">unreliable</span>}
                </div>
                <p className="text-sm text-base-content/70 mt-1">{d.finding}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-base-content/55">
                  <span className="flex items-center gap-1">
                    authenticity{" "}
                    <span className={`badge badge-xs ${BAND_BADGE[d.authenticity]}`}>{d.authenticity}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    consistency <span className={`badge badge-xs ${BAND_BADGE[d.consistency]}`}>{d.consistency}</span>
                  </span>
                  <span className={d.reliable ? "text-success" : "text-error"}>
                    {d.reliable ? "✓ reliable" : "✕ not reliable"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-base-content/50">
            Each document is checked for authenticity + consistency, then the{" "}
            {result.confidentialAi.document_analysis.length} summaries are reduced into the final decision above.
          </p>
        </Panel>
      )}

      {/* Eligibility gate — block the path to mint/certificate when the score is below threshold. */}
      {!result.eligible && (
        <Panel
          eyebrow="Not eligible yet"
          title="You can't mint a certificate with this result"
          className="mt-5"
          action={<RiskBadge tier={toUiRiskTier(result.riskTier)} size="sm" />}
        >
          <p className="text-sm text-base-content/70">
            Your combined score of <span className="k-mono font-semibold">{result.combinedScore}</span> is below the{" "}
            <span className="k-mono font-semibold">{result.minEligibleScore}</span> threshold required to issue a credit
            certificate
            {toUiRiskTier(result.riskTier) === "high" ? ", and the analysis flagged your documents as high risk" : ""}.
            The protocol issuer only attests scores at or above the threshold, so the certificate step is locked.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-base-content/65 list-disc pl-5">
            <li>Upload more complete documents (financials, tax returns, bank statements, A/R aging).</li>
            <li>Make sure each file is legible and consistent — flagged or unreliable documents lower the score.</li>
            <li>Re-run the confidential credit check once your evidence is stronger.</li>
          </ul>
        </Panel>
      )}

      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        {result.eligible ? (
          <button className="btn btn-primary gap-1" onClick={onIssue} type="button">
            Continue to mint your certificate <ArrowRightIcon className="h-4 w-4" />
          </button>
        ) : (
          <button className="btn btn-warning gap-1" onClick={onBack} type="button">
            <ArrowLeftIcon className="h-4 w-4" /> Re-run with better documents
          </button>
        )}
      </div>
    </>
  );
};
