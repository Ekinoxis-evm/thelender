"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, CheckCircleIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { HashChip, PageHeader, Panel } from "~~/components/kredito";

// The attested inference response from the Confidential AI Attester (loosely typed).
type Resource = {
  url?: string;
  digest?: string;
  request_digest?: string;
  response_digest?: string;
  content_type?: string;
  preprocessed?: boolean;
  filename_digest?: string;
  filename_blinding?: string;
};
type ResourceSummary = { filename?: string; digest?: string; content_type?: string; size?: number };
type InferenceDetail = {
  id: string;
  status: string;
  model?: string;
  system_prompt?: string;
  prompt?: string;
  output?: string;
  error?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  resource_summaries?: ResourceSummary[];
  resources?: Resource[];
  created_at?: string;
  started_at?: string;
  completed_at?: string;
};

const secondsBetween = (a?: string, b?: string) =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)) : undefined;

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 text-sm py-1.5">
    <span className="opacity-65">{label}</span>
    <span className="text-right">{children}</span>
  </div>
);

export default function InferencePage() {
  const params = useParams();
  const id = String(params.id);
  const [data, setData] = useState<InferenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/lendsignal/inference/${id}`)
      .then(r => r.json())
      .then(j => {
        if (!active) return;
        if (j.error) setError(j.message || j.error);
        else setData(j as InferenceDetail);
      })
      .catch(e => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-5 py-8 w-full">
      <Link href="/" className="btn btn-ghost btn-sm gap-1 mb-4">
        <ArrowLeftIcon className="h-4 w-4" /> Back to app
      </Link>

      <PageHeader
        eyebrow="Chainlink Confidential AI Attester"
        title="Attested inference"
        subtitle="This request ran inside an AWS Nitro Enclave (TEE). Chainlink returns cryptographic digests that bind the exact model, prompt, input document and output — so anyone can verify what ran on what data, without exposing the raw document or the borrower's private assessment. The plaintext analysis stays confidential to the borrower."
      />

      {loading && <div className="loading loading-spinner loading-lg text-primary mx-auto block mt-10" />}

      {error && (
        <div className="alert alert-error">
          <span>
            Could not load this request: {error}. Note: attested results are retained ~30 minutes by the attester.
          </span>
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Status / metadata */}
          <Panel
            eyebrow="Request"
            title={<span className="k-mono text-base break-all">{data.id}</span>}
            action={
              data.status === "completed" ? (
                <span className="badge badge-success gap-1">
                  <ShieldCheckIcon className="h-3.5 w-3.5" /> attested · TEE
                </span>
              ) : (
                <span className="badge badge-ghost">{data.status}</span>
              )
            }
          >
            <Row label="Model">
              <span className="k-mono">{data.model ?? "—"}</span>
            </Row>
            <Row label="Status">
              <span className="k-mono">{data.status}</span>
            </Row>
            {data.usage && (
              <Row label="Tokens">
                <span className="k-mono">
                  {data.usage.prompt_tokens} prompt + {data.usage.completion_tokens} completion
                </span>
              </Row>
            )}
            {secondsBetween(data.started_at, data.completed_at) !== undefined && (
              <Row label="Inference time">
                <span className="k-mono">{secondsBetween(data.started_at, data.completed_at)}s</span>
              </Row>
            )}
            {data.completed_at && (
              <Row label="Completed at">
                <span className="k-mono text-xs">{new Date(data.completed_at).toLocaleString()}</span>
              </Row>
            )}
          </Panel>

          {/* The attestation — what Chainlink gives us */}
          <Panel eyebrow="What Chainlink attests" title="Verification digests">
            <p className="text-sm text-base-content/65 mb-4">
              These SHA-256 digests are the proof. The content digest commits the exact input bytes; the
              request/response digests commit the canonical request and response; the blinded filename commits the
              filename without revealing it. The raw document never leaves the enclave.
            </p>
            {(data.resources ?? []).length === 0 && (
              <p className="text-sm text-base-content/55">No resource was attached to this request.</p>
            )}
            <div className="space-y-5">
              {(data.resources ?? []).map((res, i) => {
                const summary = data.resource_summaries?.[i];
                return (
                  <div key={i} className="rounded-box border border-base-300 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-sm">{summary?.filename ?? res.url ?? `Resource ${i + 1}`}</p>
                      <span className="text-xs opacity-60">
                        {res.content_type ?? summary?.content_type}
                        {summary?.size ? ` · ${summary.size} B` : ""}
                        {res.preprocessed ? " · preprocessed" : ""}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {res.digest && (
                        <div>
                          <p className="k-eyebrow mb-1">Content digest (sha256)</p>
                          <HashChip value={`0x${res.digest}`} lead={10} tail={8} />
                        </div>
                      )}
                      {res.request_digest && (
                        <div>
                          <p className="k-eyebrow mb-1">Request digest</p>
                          <HashChip value={`0x${res.request_digest}`} lead={10} tail={8} />
                        </div>
                      )}
                      {res.response_digest && (
                        <div>
                          <p className="k-eyebrow mb-1">Response digest</p>
                          <HashChip value={`0x${res.response_digest}`} lead={10} tail={8} />
                        </div>
                      )}
                      {res.filename_digest && (
                        <div>
                          <p className="k-eyebrow mb-1">Blinded filename digest</p>
                          <HashChip value={`0x${res.filename_digest}`} lead={10} tail={8} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* The model output + prompts are intentionally NOT shown here — they are the borrower's
              confidential assessment. This public page proves WHAT ran (model + digests) without
              revealing the content; the borrower sees their full analysis in "My evaluations". */}
          {data.error && (
            <Panel eyebrow="Status" title="Request error">
              <pre className="k-mono text-xs whitespace-pre-wrap break-words bg-base-200 rounded-box p-3">
                {data.error}
              </pre>
            </Panel>
          )}

          <p className="text-xs text-base-content/45 flex items-center gap-1">
            <CheckCircleIcon className="h-4 w-4 text-success" />
            Served via /api/lendsignal/inference — the API key stays server-side; the raw document and the private
            analysis are never returned. Only the cryptographic proof is public.
          </p>
        </div>
      )}
    </div>
  );
}
