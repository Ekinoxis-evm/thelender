"use client";

import { useEffect, useState } from "react";
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { HashChip, PageHeader, Panel } from "~~/components/kredito";
import { BAND_BADGE, SIGNAL_BADGE } from "~~/components/kredito/flowBits";

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

type CheckRow = {
  id: string;
  created_at: string;
  inference_id: string;
  model: string | null;
  attested: boolean;
  combined_score: number | null;
  risk_tier: string | null;
  eligible: boolean | null;
  attestation_hash?: string | null;
};

type DocAnalysis = {
  signal?: string;
  finding?: string;
  authenticity?: string;
  consistency?: string;
  reliable?: boolean;
  documentType?: string;
} | null;

type DocRow = {
  id: string;
  inference_id: string;
  filename: string;
  document_type: string;
  status: string;
  section_score: number | null;
  analysis: DocAnalysis;
};

type EvaluationDetail = {
  check: CheckRow & { attestation_hash: string | null; evidence_digest: string | null };
  documents: DocRow[];
};

// ----------------------------------------------------------------- detail view

const DetailView = ({
  inferenceId,
  borrower,
  onBack,
}: {
  inferenceId: string;
  borrower: string;
  onBack: () => void;
}) => {
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/lendsignal/evaluation?inferenceId=${encodeURIComponent(inferenceId)}&borrower=${borrower}`)
      .then(async r => {
        const j = await r.json();
        if (!active) return;
        if (!r.ok) {
          setError(
            j?.error === "forbidden"
              ? "This evaluation belongs to a different wallet."
              : "Could not load the evaluation details.",
          );
          return;
        }
        setDetail(j as EvaluationDetail);
      })
      .catch(() => active && setError("Could not load the evaluation details."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [inferenceId, borrower]);

  return (
    <div className="space-y-5">
      <button className="btn btn-ghost btn-sm gap-1 self-start" onClick={onBack} type="button">
        <ArrowLeftIcon className="h-4 w-4" /> Back to evaluations
      </button>

      {loading ? (
        <Panel eyebrow="Evaluation" title="Loading…">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" /> Fetching your assessment…
          </div>
        </Panel>
      ) : error ? (
        <Panel eyebrow="Evaluation" title="Unavailable">
          <p className="text-sm text-error">{error}</p>
        </Panel>
      ) : detail ? (
        <>
          <Panel
            eyebrow="Overall result"
            title="Credit assessment"
            action={
              <span className={`badge ${detail.check.risk_tier ? TIER_BADGE[detail.check.risk_tier] : "badge-ghost"}`}>
                {detail.check.risk_tier ? `${TIER_LABEL[detail.check.risk_tier]} risk` : "—"}
              </span>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="k-eyebrow mb-1">Combined score</p>
                <p className="k-mono text-2xl font-semibold">{detail.check.combined_score ?? "—"}</p>
              </div>
              <div>
                <p className="k-eyebrow mb-1">Eligible</p>
                <p className="k-mono text-2xl font-semibold">{detail.check.eligible ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="k-eyebrow mb-1">Model</p>
                <p className="k-mono text-sm font-medium truncate">{detail.check.model ?? "—"}</p>
              </div>
              <div>
                <p className="k-eyebrow mb-1">Date</p>
                <p className="text-sm font-medium">{new Date(detail.check.created_at).toLocaleString()}</p>
              </div>
            </div>
            {detail.check.attestation_hash && (
              <div className="mt-4">
                <p className="k-eyebrow mb-1">Attestation hash</p>
                <HashChip value={detail.check.attestation_hash} lead={10} tail={8} />
              </div>
            )}
            <a
              href={`/inference/${detail.check.inference_id}`}
              target="_blank"
              rel="noreferrer"
              className="link text-sm inline-flex items-center gap-1 mt-4"
            >
              <ShieldCheckIcon className="h-4 w-4" /> View the Chainlink TEE proof
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          </Panel>

          <Panel eyebrow={`Per document · ${detail.documents.length} analyzed`} title="Document breakdown">
            {detail.documents.length === 0 ? (
              <p className="text-sm text-base-content/60">No per-document analyses were stored for this evaluation.</p>
            ) : (
              <div className="divide-y divide-base-300">
                {detail.documents.map(d => (
                  <div key={d.id} className="py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {d.analysis?.signal && (
                        <span className={`badge badge-sm ${SIGNAL_BADGE[d.analysis.signal] ?? "badge-ghost"}`}>
                          {d.analysis.signal}
                        </span>
                      )}
                      <span className="font-medium text-sm">{d.analysis?.documentType || d.document_type}</span>
                      <code className="k-mono text-xs text-base-content/45">{d.filename}</code>
                      {typeof d.section_score === "number" && (
                        <span className="ml-auto k-mono text-xs text-base-content/55">score {d.section_score}</span>
                      )}
                    </div>
                    {d.analysis?.finding && <p className="text-sm text-base-content/70 mt-1">{d.analysis.finding}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-base-content/55">
                      {d.analysis?.authenticity && (
                        <span className="flex items-center gap-1">
                          authenticity{" "}
                          <span className={`badge badge-xs ${BAND_BADGE[d.analysis.authenticity] ?? "badge-ghost"}`}>
                            {d.analysis.authenticity}
                          </span>
                        </span>
                      )}
                      {d.analysis?.consistency && (
                        <span className="flex items-center gap-1">
                          consistency{" "}
                          <span className={`badge badge-xs ${BAND_BADGE[d.analysis.consistency] ?? "badge-ghost"}`}>
                            {d.analysis.consistency}
                          </span>
                        </span>
                      )}
                      {typeof d.analysis?.reliable === "boolean" && (
                        <span className={d.analysis.reliable ? "text-success" : "text-error"}>
                          {d.analysis.reliable ? "✓ reliable" : "✕ not reliable"}
                        </span>
                      )}
                      <a
                        href={`/inference/${d.inference_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link inline-flex items-center gap-1"
                      >
                        TEE proof <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-base-content/50">
              Each document was checked privately inside the Chainlink TEE for authenticity + consistency, then reduced
              into the overall decision above. Raw documents and prompts never leave the enclave.
            </p>
          </Panel>
        </>
      ) : null}
    </div>
  );
};

// ----------------------------------------------------------------- list view

/**
 * "My evaluations" — the wallet's historic credit checks with drill-down into the per-document
 * analysis + the overall score + attestation hash + a link to the TEE proof for each.
 */
export const EvaluationsSection = ({ borrower }: { borrower: string }) => {
  const [checks, setChecks] = useState<CheckRow[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/lendsignal/checks?limit=25&borrower=${borrower}`)
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

  if (selected) {
    return <DetailView inferenceId={selected} borrower={borrower} onBack={() => setSelected(null)} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="My evaluations"
        subtitle="Every confidential credit check this wallet has run, with a full per-document breakdown and a link to the Chainlink TEE proof."
      />
      <Panel eyebrow="Credit checks" title="Your assessments">
        {!configured ? (
          <p className="text-sm text-base-content/60">Evaluation history is unavailable (Supabase not configured).</p>
        ) : checks === null ? (
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" /> Loading your evaluations…
          </div>
        ) : checks.length === 0 ? (
          <p className="text-sm text-base-content/55">No evaluations stored yet for this wallet.</p>
        ) : (
          <div className="divide-y divide-base-300">
            {checks.map(c => (
              <div key={c.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="k-mono text-xs text-base-content/55 w-32 shrink-0">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
                <span className="k-mono font-semibold w-12 shrink-0">{c.combined_score ?? "—"}</span>
                <span className={`badge badge-sm shrink-0 ${c.risk_tier ? TIER_BADGE[c.risk_tier] : "badge-ghost"}`}>
                  {c.risk_tier ? TIER_LABEL[c.risk_tier] : "—"}
                </span>
                <span
                  className={`badge badge-sm badge-ghost shrink-0 ${c.eligible ? "text-success" : "text-base-content/50"}`}
                >
                  {c.eligible ? "eligible" : "not eligible"}
                </span>
                {c.attested && <span className="badge badge-ghost badge-sm shrink-0">TEE</span>}
                <code className="k-mono text-xs text-base-content/45 truncate flex-1 hidden sm:block">
                  {c.inference_id}
                </code>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0"
                  onClick={() => setSelected(c.inference_id)}
                >
                  View details
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
};
