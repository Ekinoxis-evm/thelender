"use client";

import { useEffect, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  CheckIcon,
  DocumentDuplicateIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { HashChip, PageHeader, Panel, RiskBadge, ScoreMeter, SignalRow } from "~~/components/kredito";
import { IdentitySection } from "~~/components/kredito/IdentitySection";
import { RecentChecks } from "~~/components/kredito/RecentChecks";
import { formatUsd } from "~~/kredito/format";
import { DEMO_BORROWERS, DEMO_PROFILE, DEMO_VAULT } from "~~/kredito/mock";
import { type StoredScore, saveScoreResult, toUiRiskTier } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import type { UploadedDocument } from "~~/services/lendsignal/types";
import { notification } from "~~/utils/scaffold-eth";

const STEPS = ["Onboarding", "Score", "Identity", "Borrow", "Liquidity"] as const;

// Each required document gets its own upload slot so the user submits them one by one.
const REQUIRED_DOCS = [
  { key: "financials", label: "Financial statements", hint: "Balance sheet · P&L · cash flow" },
  { key: "tax", label: "Tax returns", hint: "Business · last 2–3 years" },
  { key: "bank", label: "Bank statements", hint: "Last 6–12 months" },
  { key: "ar", label: "A/R aging report", hint: "Current + historical" },
  { key: "debt", label: "Debt schedule", hint: "Outstanding loans & terms" },
  { key: "legal", label: "Legal documents", hint: "Articles · EIN · licenses" },
] as const;

const MAX_BYTES = 10 * 1024 * 1024;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

const SIGNAL_BADGE: Record<string, string> = {
  positive: "badge-success",
  neutral: "badge-ghost",
  negative: "badge-error",
};
const BAND_BADGE: Record<string, string> = {
  low: "badge-success",
  medium: "badge-warning",
  high: "badge-error",
};
const DECISION_BADGE: Record<string, string> = {
  approved: "badge-success",
  manual_review: "badge-warning",
  denied: "badge-error",
};
const DECISION_LABEL: Record<string, string> = {
  approved: "Approved",
  manual_review: "Manual review",
  denied: "Denied",
};

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// ---------------------------------------------------------------- small pieces

const Stepper = ({ current, maxStep, onJump }: { current: number; maxStep: number; onJump: (i: number) => void }) => (
  <div className="k-card p-2 mb-6 flex items-center gap-1 overflow-x-auto">
    {STEPS.map((label, i) => {
      const active = i === current;
      const reachable = i <= maxStep;
      return (
        <button
          key={label}
          type="button"
          disabled={!reachable}
          onClick={() => onJump(i)}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
            active
              ? "bg-primary text-primary-content"
              : reachable
                ? "hover:bg-base-200 text-base-content/80"
                : "opacity-40 cursor-not-allowed"
          }`}
        >
          <span
            className={`grid place-items-center h-5 w-5 rounded-full text-xs ${
              active ? "bg-primary-content/20" : "bg-base-300"
            }`}
          >
            {i < current ? <CheckIcon className="h-3 w-3" /> : i + 1}
          </span>
          {label}
        </button>
      );
    })}
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) => (
  <label className="block">
    <span className="k-eyebrow">{label}</span>
    <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-transparent py-2.5 outline-none text-sm"
      />
      {suffix && <span className="k-mono text-xs text-base-content/45">{suffix}</span>}
    </div>
  </label>
);

const DocSlot = ({
  label,
  hint,
  value,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  value: UploadedDocument | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) => (
  <div className="flex items-center gap-3 rounded-field border border-base-300 px-3 py-2.5">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium truncate">{label}</p>
      <p className={`text-xs truncate ${value ? "text-success" : "text-base-content/55"}`}>
        {value ? value.filename : hint}
      </p>
    </div>
    {value ? (
      <>
        <CheckCircleIcon className="h-5 w-5 text-success shrink-0" />
        <button type="button" onClick={onClear} aria-label="Remove">
          <XMarkIcon className="h-4 w-4 text-base-content/50" />
        </button>
      </>
    ) : (
      <label className="btn btn-ghost btn-xs gap-1 cursor-pointer">
        <ArrowUpTrayIcon className="h-3.5 w-3.5" /> Upload
        <input
          type="file"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
        />
      </label>
    )}
  </div>
);

const SLOT_KEYS = REQUIRED_DOCS.map(d => d.key) as readonly string[];

/** Map a filename to one of the evidence slots (mirrors the server's detectSection). */
const detectSlot = (filename: string): string | null => {
  const f = filename.toLowerCase();
  if (/(income|financ|p&l|profit|balance|cash.?flow)/.test(f)) return "financials";
  if (/tax/.test(f)) return "tax";
  if (/bank|statement/.test(f)) return "bank";
  if (/(a\/?r|receivable|aging)/.test(f)) return "ar";
  if (/debt|loan|liab/.test(f)) return "debt";
  if (/legal|article|license|formation|incorp|ein/.test(f)) return "legal";
  return null;
};

/** Animated multi-step loader shown while the map→reduce pipeline runs. */
const AnalyzingProgress = ({ steps }: { steps: string[] }) => {
  const [done, setDone] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setDone(0);
    setElapsed(0);
    const stepTimer = setInterval(() => setDone(d => Math.min(d + 1, steps.length - 1)), 12000);
    const clock = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => {
      clearInterval(stepTimer);
      clearInterval(clock);
    };
  }, [steps.length]);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const onLast = done >= steps.length - 1;

  return (
    <div className="k-card p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-md text-primary" />
          <p className="font-semibold">Running confidential analysis…</p>
        </div>
        <span className="k-mono text-sm text-base-content/60 tabular-nums">{mmss}</span>
      </div>
      <p className="text-xs text-base-content/55 mb-5">
        Each document is analyzed one by one in the Chainlink TEE, then reduced to a decision. PDFs go through Docling
        preprocessing, so this can take ~2–3 minutes — keep this tab open.
      </p>
      <ul className="space-y-2.5">
        {steps.map((s, i) => {
          const isLastStep = i === steps.length - 1;
          // The final step keeps spinning (with the elapsed clock) until the server responds.
          const isDone = i < done && !(isLastStep && onLast);
          const isCurrent = i === done || (isLastStep && onLast);
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span
                className={`grid place-items-center h-5 w-5 rounded-full shrink-0 ${
                  isDone ? "bg-success text-success-content" : isCurrent ? "bg-primary/15" : "bg-base-300"
                }`}
              >
                {isDone ? (
                  <CheckIcon className="h-3 w-3" />
                ) : isCurrent ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  i + 1
                )}
              </span>
              <span className={isDone ? "text-base-content/60" : isCurrent ? "font-medium" : "text-base-content/45"}>
                {s}
              </span>
            </li>
          );
        })}
      </ul>
      {onLast && (
        <p className="mt-4 text-xs text-base-content/50">
          Finalizing the verdict — almost there. Large PDFs can push this past 2 minutes.
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- the flow

export const KreditoFlow = () => {
  const { address, isSmartWallet } = useKreditoWallet();

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  const [profile, setProfile] = useState(DEMO_PROFILE);
  const [archetype, setArchetype] = useState<string>("strong");
  const [docs, setDocs] = useState<Record<string, UploadedDocument | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [analyzingSteps, setAnalyzingSteps] = useState<string[]>([]);
  const [loadedCase, setLoadedCase] = useState<"success" | "risk" | null>(null);
  const [result, setResult] = useState<StoredScore | null>(null);

  const set = (k: keyof typeof profile) => (v: string) => setProfile(p => ({ ...p, [k]: v }));
  const uploadedDocs = Object.values(docs).filter(Boolean) as UploadedDocument[];

  const jump = (s: number) => s <= maxStep && setStep(s);
  const advance = (s: number) => {
    setMaxStep(m => Math.max(m, s));
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pickDoc = async (key: string, file: File) => {
    if (file.size > MAX_BYTES) {
      notification.error(`${file.name} exceeds 10 MiB.`);
      return;
    }
    try {
      const doc: UploadedDocument = {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: await fileToBase64(file),
      };
      setDocs(prev => ({ ...prev, [key]: doc }));
    } catch {
      notification.error("Could not read the file.");
    }
  };

  // Load a use-case document set (success | risk) from public/docs/<case> into the slots.
  const loadSamples = async (caseId: "success" | "risk" = "success", silent = false) => {
    try {
      const res = await fetch(`/api/lendsignal/sample-docs?case=${caseId}`);
      const json = await res.json();
      const sample: UploadedDocument[] = json.documents ?? [];
      if (!sample.length) {
        if (!silent) notification.error(`No documents found for the ${caseId} case.`);
        return;
      }
      const next: Record<string, UploadedDocument | null> = {};
      const taken = new Set<string>();
      for (const d of sample) {
        let key = detectSlot(d.filename);
        if (!key || taken.has(key)) key = SLOT_KEYS.find(k => !taken.has(k)) ?? null;
        if (key) {
          next[key] = d;
          taken.add(key);
        }
      }
      setDocs(next);
      setLoadedCase(caseId);
      if (!silent) notification.success(`Loaded the ${caseId} case (${sample.length} docs)`);
    } catch {
      if (!silent) notification.error("Could not load documents.");
    }
  };

  // Preload the success case once so the full happy-path exercise is ready to run.
  useEffect(() => {
    void loadSamples("success", true);
  }, []);

  const runCreditCheck = async () => {
    setSubmitting(true);
    const steps =
      uploadedDocs.length > 0
        ? uploadedDocs.map(d => `Analyze ${d.filename}`)
        : REQUIRED_DOCS.map(d => `Analyze ${d.label}`);
    steps.push("Reduce to a final decision", "Off-chain profile analysis");
    setAnalyzingSteps(steps);
    try {
      const apiProfile = {
        legalName: profile.legalName,
        country: profile.country,
        industry: profile.industry,
        requestedLoanUsd: profile.requestedLoanUsd,
        ensName: profile.ensName || undefined,
      };
      // Uploaded documents take the real path; otherwise the chosen demo archetype.
      const base = { profile: apiProfile, borrower: address };
      // The loaded case tunes the (mock) bureau + off-chain signal to match it; the
      // document-based AI score stays real (no clamp on uploads).
      const strengthHint = loadedCase === "risk" ? "weak" : loadedCase === "success" ? "strong" : undefined;
      const body =
        uploadedDocs.length > 0
          ? { ...base, documents: uploadedDocs, ...(strengthHint ? { strength: strengthHint } : {}) }
          : { ...base, demoProfileId: archetype };

      const res = await fetch("/api/lendsignal/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Scoring failed");

      setResult(json as StoredScore);
      saveScoreResult(json);
      notification.success("Confidential credit check complete");
      advance(1);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Scoring failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-5 py-8 w-full">
      <Stepper current={step} maxStep={maxStep} onJump={jump} />

      {/* STEP 1 — ONBOARDING */}
      {step === 0 && (
        <>
          <PageHeader
            step={1}
            eyebrow="Business onboarding"
            title="Become a credit identity"
            subtitle="Submit your business profile and upload each piece of evidence. The connected wallet becomes the onchain identifier behind your credit identity and the lending pool."
          />
          {submitting && <AnalyzingProgress steps={analyzingSteps} />}
          <div className={submitting ? "hidden" : "grid lg:grid-cols-3 gap-5"}>
            <div className="lg:col-span-2 space-y-5">
              <Panel eyebrow="Business profile" title="Company information">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Legal name" value={profile.legalName} onChange={set("legalName")} />
                  <Field label="Country / market" value={profile.country} onChange={set("country")} />
                  <Field label="Industry" value={profile.industry} onChange={set("industry")} />
                  <Field label="ENS name" value={profile.ensName ?? ""} onChange={set("ensName")} suffix=".eth" />
                  <Field
                    label="Monthly revenue (USD)"
                    value={String(profile.monthlyRevenueUsd)}
                    onChange={v => setProfile(p => ({ ...p, monthlyRevenueUsd: Number(v) || 0 }))}
                  />
                  <Field
                    label="Requested loan (USD)"
                    value={String(profile.requestedLoanUsd)}
                    onChange={v => setProfile(p => ({ ...p, requestedLoanUsd: Number(v) || 0 }))}
                  />
                </div>
              </Panel>

              <Panel
                eyebrow="Evidence"
                title="Upload documents"
                action={
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => loadSamples("success")}
                      className={`btn btn-xs ${loadedCase === "success" ? "btn-primary" : "btn-ghost"}`}
                    >
                      Success case
                    </button>
                    <button
                      type="button"
                      onClick={() => loadSamples("risk")}
                      className={`btn btn-xs ${loadedCase === "risk" ? "btn-primary" : "btn-ghost"}`}
                    >
                      Risk case
                    </button>
                    <span className="k-mono text-xs text-base-content/55 ml-1">
                      {uploadedDocs.length}/{REQUIRED_DOCS.length}
                    </span>
                  </div>
                }
              >
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {REQUIRED_DOCS.map(d => (
                    <DocSlot
                      key={d.key}
                      label={d.label}
                      hint={d.hint}
                      value={docs[d.key] ?? null}
                      onPick={file => pickDoc(d.key, file)}
                      onClear={() => setDocs(prev => ({ ...prev, [d.key]: null }))}
                    />
                  ))}
                </div>
                <p className="mt-3 text-xs text-base-content/55">
                  Prefer small <code>.txt</code>/<code>.png</code> files (fast TEE preprocessing). No uploads? The
                  selected demo borrower attaches representative documents. Raw files never leave the enclave or go
                  onchain.
                </p>
              </Panel>
            </div>

            <div className="space-y-5">
              <Panel eyebrow="Demo" title="Borrower profile">
                <div className="space-y-2">
                  {DEMO_BORROWERS.map(b => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setArchetype(b.key)}
                      disabled={uploadedDocs.length > 0}
                      className={`w-full text-left rounded-field border px-3 py-2.5 transition-colors disabled:opacity-40 ${
                        archetype === b.key && uploadedDocs.length === 0
                          ? "border-primary bg-primary/5"
                          : "border-base-300 hover:bg-base-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{b.label}</span>
                        <span className="k-mono text-xs text-base-content/50">
                          {b.ai}/{b.bureau}
                        </span>
                      </div>
                      <p className="text-xs text-base-content/55 mt-0.5">{b.blurb}</p>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel eyebrow="Wallet" title="Credit identity">
                {address ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-2 w-2 rounded-full bg-success" />
                      {isSmartWallet ? "Smart wallet connected" : "Wallet connected"}
                    </div>
                    <AddressDisplay address={address} />
                  </div>
                ) : (
                  <p className="text-sm text-base-content/60">Connect a wallet to set your credit identity.</p>
                )}
              </Panel>

              <button className="btn btn-primary w-full gap-2" onClick={runCreditCheck} disabled={submitting}>
                {submitting ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Running confidential inference…
                  </>
                ) : (
                  <>
                    Run confidential credit check
                    <ArrowRightIcon className="h-4 w-4" />
                  </>
                )}
              </button>
              <p className="text-center text-xs text-base-content/45 -mt-2">Attested in the Chainlink TEE · ~10–40s</p>
            </div>
          </div>
          {!submitting && <RecentChecks borrower={address} />}
        </>
      )}

      {/* STEP 2 — SCORE */}
      {step === 1 && result && <ScoreSection result={result} onBack={() => setStep(0)} onIssue={() => advance(2)} />}

      {/* STEP 3 — IDENTITY */}
      {step === 2 && result && (
        <IdentitySection
          result={result}
          borrower={(address ?? ZERO_ADDR) as `0x${string}`}
          onBack={() => setStep(1)}
          onNext={() => advance(3)}
        />
      )}

      {/* STEP 4 — BORROW (demo) */}
      {step === 3 && <BorrowSection result={result} onBack={() => setStep(2)} onNext={() => advance(4)} />}

      {/* STEP 5 — LIQUIDITY (demo) */}
      {step === 4 && <LiquiditySection onBack={() => setStep(3)} />}
    </div>
  );
};

// ---------------------------------------------------------------- sections

const ScoreSection = ({
  result,
  onBack,
  onIssue,
}: {
  result: StoredScore;
  onBack: () => void;
  onIssue: () => void;
}) => {
  const ai = result.scoreInputs.confidentialAiScore;
  const bureau = result.scoreInputs.bureauScore;
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
        title="Two signals, one score"
        subtitle="A Chainlink Confidential AI attestation and a CRS credit-bureau signal blended into a single 0–1000 score."
      />
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel
          eyebrow="Result"
          title="Combined score"
          className="lg:col-span-2"
          action={
            result.attested ? (
              <span className="badge badge-success gap-1">
                <ShieldCheckIcon className="h-3.5 w-3.5" /> Attested (TEE)
              </span>
            ) : (
              <span className="badge badge-ghost">mock</span>
            )
          }
        >
          <ScoreMeter score={result.combinedScore} />
          <div className="mt-7 space-y-5">
            <SignalRow
              name="Confidential AI Attester"
              source="Chainlink · runs in a TEE"
              score={ai}
              weightBps={7000}
              accent="bg-primary"
            />
            <SignalRow
              name="Credit-risk bureau"
              source="CRS · business credit history"
              score={bureau}
              weightBps={3000}
              accent="bg-accent"
            />
          </div>
          <div className="mt-6 rounded-field bg-base-200 px-4 py-3 k-mono text-sm">
            combinedScore = {ai}·70% + {bureau}·30% = <span className="font-semibold">{result.combinedScore}</span>
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
              {result.attested ? (
                <span className="badge badge-success badge-sm">attested · TEE</span>
              ) : (
                <span className="badge badge-ghost badge-sm">mock</span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="k-mono text-sm break-all flex-1">{result.inferenceId}</code>
              {!result.inferenceId.startsWith("mock") && (
                <a
                  href={`/inference/${result.inferenceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-xs gap-1 shrink-0"
                >
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> View
                </a>
              )}
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
              These three digests (your <code>ScoreInputs</code>) anchor your credit identity onchain — the attestation
              becomes your financial ID. Raw evidence stays offchain.
            </p>
            <div className="space-y-2.5">
              <div>
                <p className="k-eyebrow mb-1">Attestation</p>
                <HashChip value={result.scoreInputs.attestationHash} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Bureau report</p>
                <HashChip value={result.scoreInputs.bureauReportHash} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Evidence digest</p>
                <HashChip value={result.scoreInputs.evidenceDigest} />
              </div>
            </div>
            {!result.inferenceId.startsWith("mock") && (
              <a
                href={`/inference/${result.inferenceId}`}
                target="_blank"
                rel="noreferrer"
                className="link text-xs inline-flex items-center gap-1 mt-3"
              >
                Verify the Chainlink attestation
                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
            )}
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
              {result.eligible ? "Eligible — score ≥ 750" : "Not eligible — below 750 / high risk"}
            </div>
          </Panel>
        </div>
      </div>

      {/* All Confidential AI queries that ran (per-section + reduce + off-chain) */}
      {result.inferences && result.inferences.length > 0 && (
        <Panel eyebrow={`${result.inferences.length} queries`} title="Confidential AI requests" className="mt-5">
          <div className="divide-y divide-base-300">
            {result.inferences.map(q => {
              const real = !q.inferenceId.startsWith("mock");
              return (
                <div key={q.inferenceId} className="flex items-center gap-3 py-2 text-sm">
                  <span className={`badge badge-sm shrink-0 ${q.attested ? "badge-success" : "badge-ghost"}`}>
                    {q.attested ? "TEE" : "mock"}
                  </span>
                  <span className="font-medium w-40 sm:w-48 shrink-0 truncate">{q.label}</span>
                  {real ? (
                    <a
                      href={`/inference/${q.inferenceId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="link k-mono text-xs truncate flex-1 inline-flex items-center gap-1"
                    >
                      {q.inferenceId}
                      <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <code className="k-mono text-xs text-base-content/55 truncate flex-1">{q.inferenceId}</code>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-base-content/50">
            One attested request per document, one for the final decision, plus the off-chain profile query.
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

      {/* Second query — off-chain profile/industry analysis (no documents) */}
      {result.offchain && (
        <Panel
          eyebrow="Second query · off-chain"
          title="Profile & industry analysis"
          className="mt-5"
          action={
            result.offchain.attested ? (
              <span className="badge badge-info badge-sm">off-chain · TEE</span>
            ) : (
              <span className="badge badge-ghost badge-sm">mock</span>
            )
          }
        >
          <div className="grid sm:grid-cols-3 gap-4 mb-3">
            <div>
              <p className="k-eyebrow mb-1">Profile score</p>
              <p className="k-mono text-2xl font-semibold">{result.offchain.profileScore}</p>
            </div>
            <div>
              <p className="k-eyebrow mb-1">Industry risk</p>
              <span className={`badge ${BAND_BADGE[result.offchain.industryRisk]}`}>
                {result.offchain.industryRisk}
              </span>
            </div>
            <div>
              <p className="k-eyebrow mb-1">Request ID</p>
              <code className="k-mono text-xs break-all">{result.offchain.inferenceId}</code>
            </div>
          </div>
          {result.offchain.summary && <p className="text-sm text-base-content/70">{result.offchain.summary}</p>}
          {result.offchain.marketView && (
            <p className="text-xs text-base-content/55 mt-1">{result.offchain.marketView}</p>
          )}
          <p className="text-xs text-base-content/45 mt-2">
            Complementary signal from the public profile only — not part of the onchain score.
          </p>
        </Panel>
      )}

      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <button className="btn btn-primary gap-1" onClick={onIssue} type="button">
          Claim your identity <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};

const BorrowSection = ({
  result,
  onBack,
  onNext,
}: {
  result: StoredScore | null;
  onBack: () => void;
  onNext: () => void;
}) => {
  const eligible = result?.eligible ?? false;
  const limit = result?.bureau.recommendedCreditLimitUsd ?? DEMO_VAULT.liquidityUsd;
  const fee = Math.round((limit * DEMO_VAULT.originationFeeBps) / 10_000);
  return (
    <>
      <PageHeader
        step={4}
        eyebrow="Working-capital loan"
        title="Borrow against your credit identity"
        subtitle="The pool reads your credit identity and pays out an undercollateralized loan at the 12% APY default rate. (Lending layer — demo.)"
      />
      <Panel eyebrow="Offer" title="Loan offer">
        {eligible ? (
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <p className="k-eyebrow mb-1">Credit limit</p>
              <p className="k-mono text-2xl font-semibold">{formatUsd(limit)}</p>
            </div>
            <div>
              <p className="k-eyebrow mb-1">Origination fee</p>
              <p className="k-mono text-2xl font-semibold">{formatUsd(fee)}</p>
            </div>
            <div>
              <p className="k-eyebrow mb-1">Min score</p>
              <p className="k-mono text-2xl font-semibold">{DEMO_VAULT.minScore}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-error">Not eligible — improve the score before borrowing.</p>
        )}
      </Panel>
      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <button className="btn btn-primary gap-1" onClick={onNext} type="button">
          Continue to liquidity <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};

const LiquiditySection = ({ onBack }: { onBack: () => void }) => (
  <>
    <PageHeader
      step={5}
      eyebrow="Liquidity & default fund"
      title="Where the money comes from"
      subtitle="Liquidity providers fund the vault; origination fees build a reserve that covers defaults. (Liquidity layer — demo.)"
    />
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { label: "Vault liquidity", value: formatUsd(DEMO_VAULT.liquidityUsd, true) },
        { label: "Default reserve", value: formatUsd(DEMO_VAULT.reserveUsd, true) },
        { label: "Outstanding", value: formatUsd(DEMO_VAULT.totalOutstandingUsd, true) },
        { label: "Origination fee", value: `${DEMO_VAULT.originationFeeBps / 100}%` },
      ].map(s => (
        <div key={s.label} className="k-card p-5">
          <p className="k-eyebrow mb-1">{s.label}</p>
          <p className="k-mono text-2xl font-semibold">{s.value}</p>
        </div>
      ))}
    </div>
    <div className="flex justify-between mt-6">
      <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
        <ArrowLeftIcon className="h-4 w-4" /> Back
      </button>
    </div>
  </>
);
