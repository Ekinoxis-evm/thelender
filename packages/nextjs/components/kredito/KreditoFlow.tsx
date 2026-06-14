"use client";

import { useEffect, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import { encodeFunctionData, formatUnits, parseUnits, recoverTypedDataAddress } from "viem";
import { useReadContract } from "wagmi";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  BanknotesIcon,
  CheckCircleIcon,
  CheckIcon,
  DocumentDuplicateIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CertificateCard, HashChip, PageHeader, Panel, RiskBadge, ScoreMeter, SignalRow } from "~~/components/kredito";
import { RecentChecks } from "~~/components/kredito/RecentChecks";
import { useSmartWalletSign, useSponsoredWrite } from "~~/hooks/scaffold-eth/useSmartWallet";
import { toTypedMessage, typedData } from "~~/kredito/attestation";
import { formatUsd } from "~~/kredito/format";
import { DEMO_BORROWERS, DEMO_PROFILE, DEMO_VAULT } from "~~/kredito/mock";
import { type StoredScore, saveScoreResult, toCertificate, toUiRiskTier } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import {
  ERC20_ABI,
  KREDITO_VAULT_ADDRESS,
  type SignedAttestation,
  VAULT_ABI,
  VAULT_CHAIN_ID,
  type VaultLoan,
  sepoliaTxUrl,
} from "~~/kredito/vault";
import { fullName, mintMessage, normalizeLabel } from "~~/lib/kredito";
import type { UploadedDocument } from "~~/services/lendsignal/types";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

const STEPS = ["Onboarding", "Score", "Certificate", "Borrow", "Liquidity"] as const;

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
  // The issuer-signed attestation, produced in the Certificate step and consumed by Borrow.
  const [att, setAtt] = useState<SignedAttestation | null>(null);

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
            subtitle="Submit your business profile and upload each piece of evidence. The connected wallet becomes the onchain identifier used by the certificate and the lending vault."
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

      {/* STEP 3 — CERTIFICATE */}
      {step === 2 && result && (
        <CertificateSection
          result={result}
          borrower={(address ?? ZERO_ADDR) as `0x${string}`}
          ensName={profile.ensName ?? ""}
          att={att}
          setAtt={setAtt}
          onBack={() => setStep(1)}
          onNext={() => advance(3)}
        />
      )}

      {/* STEP 4 — BORROW (onchain) */}
      {step === 3 && (
        <BorrowSection
          result={result}
          borrower={(address ?? ZERO_ADDR) as `0x${string}`}
          att={att}
          onBack={() => setStep(2)}
          onNext={() => advance(4)}
        />
      )}

      {/* STEP 5 — LIQUIDITY (ERC-4626 + ERC-7540 async redeem) */}
      {step === 4 && <LiquiditySection borrower={(address ?? ZERO_ADDR) as `0x${string}`} onBack={() => setStep(3)} />}
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
              These three digests (the certificate&apos;s <code>ScoreInputs</code>) are written onchain when you issue
              the certificate. Raw evidence stays offchain.
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
          Issue certificate <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};

// Best-effort seed for the subname label from a typed ENS name (strip the TLD); "" on any failure
// so an un-normalizable input never throws during render.
const safeLabel = (ensName: string): string => {
  const raw = (ensName || "").trim().split(".")[0] ?? "";
  try {
    return raw ? normalizeLabel(raw) : "";
  } catch {
    return "";
  }
};

const CertificateSection = ({
  result,
  borrower,
  ensName,
  att,
  setAtt,
  onBack,
  onNext,
}: {
  result: StoredScore;
  borrower: `0x${string}`;
  ensName: string;
  att: SignedAttestation | null;
  setAtt: (a: SignedAttestation | null) => void;
  onBack: () => void;
  onNext: () => void;
}) => {
  const cert = toCertificate(result, borrower);
  const [signing, setSigning] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);

  // Verify the signature exactly as the vault does onchain (recover signer == issuer).
  // Recompute whenever `att` changes, so returning to this step keeps the verified badge.
  useEffect(() => {
    if (!att) {
      setVerified(null);
      return;
    }
    let cancelled = false;
    recoverTypedDataAddress({
      ...typedData(att.attestation, KREDITO_VAULT_ADDRESS as `0x${string}`),
      signature: att.signature,
    })
      .then(r => !cancelled && setVerified(r.toLowerCase() === att.issuer.toLowerCase()))
      .catch(() => !cancelled && setVerified(false));
    return () => {
      cancelled = true;
    };
  }, [att]);

  const signMessage = useSmartWalletSign();
  const [label, setLabel] = useState(() => safeLabel(ensName));
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<{ label: string; txHash: `0x${string}` } | null>(null);

  // Mint the borrower's `<label>.kredito.eth` ENSv2 subname as the onchain credit certificate.
  // The user signs a message proving wallet control; the backend issuer (which holds ISSUER_ROLE)
  // submits the actual mint and Privy sponsors that gas. Gated server-side on the approved decision.
  const mintIdentity = async () => {
    let normalized: string;
    try {
      normalized = normalizeLabel(label);
    } catch (e) {
      notification.error((e as Error).message);
      return;
    }
    setMinting(true);
    try {
      const signature = await signMessage(mintMessage(borrower, normalized));
      const res = await fetch("/api/identity/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: borrower, label: normalized, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Mint failed");
      setMinted({ label: normalized, txHash: json.txHash });
      notification.success(`Minted ${fullName(normalized)}`);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  // Option B: the issuer SIGNS an EIP-712 attestation; the vault verifies it onchain.
  const signAttestation = async () => {
    setSigning(true);
    try {
      const res = await fetch("/api/lendsignal/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrower,
          score: result.combinedScore,
          riskTier: result.riskTier,
          evidenceDigest: result.scoreInputs.evidenceDigest,
          expiresAt: result.scoreInputs.expiresAt,
          // H-2: issuer-bound loan cap. Demo asset is 6-decimal mUSDC where 1 unit == $1, so the
          // recommended USD credit limit maps directly to base units. The vault enforces amount <= this.
          maxPrincipal: (
            BigInt(Math.max(0, Math.round(result.bureau.recommendedCreditLimitUsd))) * 1_000_000n
          ).toString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Signing failed");
      // H-2: API serializes maxPrincipal as a string (JSON has no bigint); coerce back to bigint so the
      // borrow tuple / typed-data encode correctly.
      const signed: SignedAttestation = {
        ...(json as SignedAttestation),
        attestation: { ...json.attestation, maxPrincipal: BigInt(json.attestation.maxPrincipal) },
      };
      setAtt(signed);
      notification.success("Attestation signed by the protocol issuer");
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setSigning(false);
    }
  };

  return (
    <>
      <PageHeader
        step={3}
        eyebrow="Credit identity"
        title="Sign your attestation, mint your identity"
        subtitle="The protocol issuer signs an EIP-712 attestation over your score (the vault verifies it onchain to gate the loan). Then mint your own .kredito.eth subname as the credit certificate — the issuer writes a locked approved status, and you own the name."
      />
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="flex justify-center">
          <CertificateCard cert={cert} />
        </div>
        <div className="space-y-4">
          <Panel eyebrow="Summary" title="What gets attested">
            <ul className="space-y-2 text-sm text-base-content/75">
              <li className="flex justify-between">
                <span>Combined score</span>
                <span className="k-mono font-semibold">{cert.combinedScore}</span>
              </li>
              <li className="flex justify-between">
                <span>Risk tier</span>
                <RiskBadge tier={cert.riskTier} size="sm" />
              </li>
              <li className="flex justify-between">
                <span>Status</span>
                <span className="k-mono">{att ? "ATTESTED" : cert.status}</span>
              </li>
            </ul>
          </Panel>

          <Panel eyebrow="Issuer attestation · EIP-712" title="Sign credit attestation">
            {att ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {verified ? (
                    <span className="text-success inline-flex items-center gap-1.5">
                      <CheckCircleIcon className="h-5 w-5" /> Verified — recovered signer = issuer
                    </span>
                  ) : (
                    <span className="text-error">Signature did not verify</span>
                  )}
                </div>
                <div>
                  <p className="k-eyebrow mb-1">Issuer (signer)</p>
                  <AddressDisplay address={att.issuer} />
                </div>
                <div>
                  <p className="k-eyebrow mb-1">Signature</p>
                  <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2">{att.signature}</code>
                </div>
                <div>
                  <p className="k-eyebrow mb-1">EIP-712 digest</p>
                  <HashChip value={att.digest} lead={10} tail={8} />
                </div>
                <p className="text-xs text-base-content/50">
                  The vault calls <code>isEligible(attestation, signature)</code> — it recovers the signer onchain and
                  checks it equals the issuer. No registry write needed.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-base-content/65 mb-3">
                  The protocol issuer signs an EIP-712 <code>CreditAttestation</code> (borrower, score, risk tier,
                  evidence digest, expiry). The vault verifies it onchain to approve the loan.
                </p>
                <button className="btn btn-primary btn-sm w-full gap-1" onClick={signAttestation} disabled={signing}>
                  {signing ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Signing…
                    </>
                  ) : (
                    <>
                      <ShieldCheckIcon className="h-4 w-4" /> Sign credit attestation
                    </>
                  )}
                </button>
              </>
            )}
          </Panel>

          {/* Mint the *.kredito.eth credit identity (ENSv2 subname) — the onchain certificate. */}
          <Panel eyebrow="ENS credit identity · Sepolia" title="Mint your kredito.eth identity">
            {!att ? (
              <p className="text-sm text-base-content/55">Sign the attestation above first, then mint your identity.</p>
            ) : minted ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-success">
                  <CheckCircleIcon className="h-5 w-5" /> Minted{" "}
                  <span className="k-mono">{fullName(minted.label)}</span>
                </div>
                <p className="text-sm text-base-content/65">
                  Your onchain credit identity is live. The issuer-locked <code>kredito.status</code> record reads{" "}
                  <span className="k-mono">approved</span> — you own the name and can edit your profile records, but not
                  the status.
                </p>
                <div>
                  <p className="k-eyebrow mb-1">Mint transaction</p>
                  <HashChip value={minted.txHash} lead={10} tail={8} />
                </div>
                <a
                  href={sepoliaTxUrl(minted.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-sm inline-flex items-center gap-1"
                >
                  View on explorer
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-base-content/65">
                  Mint a <span className="k-mono">{fullName("yourname")}</span> subname as your credit certificate. The
                  approved status + attestation hash are written by the issuer and locked onchain; you own the name.
                </p>
                <label className="form-control">
                  <span className="k-eyebrow mb-1">Choose your label</span>
                  <div className="join">
                    <input
                      className="input input-bordered input-sm join-item flex-1 k-mono"
                      placeholder="acme"
                      value={label}
                      onChange={e => setLabel(e.target.value)}
                    />
                    <span className="btn btn-sm btn-disabled join-item k-mono no-animation">.kredito.eth</span>
                  </div>
                </label>
                <button
                  className="btn btn-primary btn-sm w-full gap-1"
                  onClick={mintIdentity}
                  disabled={minting || !label.trim()}
                >
                  {minting ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Minting…
                    </>
                  ) : (
                    <>
                      <GlobeAltIcon className="h-4 w-4" /> Mint{" "}
                      {safeLabel(label) ? <span className="k-mono">{fullName(safeLabel(label))}</span> : "identity"}
                    </>
                  )}
                </button>
                <p className="text-xs text-base-content/50">
                  You sign a message to prove wallet control; the issuer submits the mint and Privy sponsors the gas.
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <button className="btn btn-primary gap-1" onClick={onNext} type="button">
          Continue to borrow <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="k-eyebrow mb-1">{label}</p>
    <p className="k-mono text-2xl font-semibold">{value}</p>
  </div>
);

const BorrowSection = ({
  result,
  borrower,
  att,
  onBack,
  onNext,
}: {
  result: StoredScore | null;
  borrower: `0x${string}`;
  att: SignedAttestation | null;
  onBack: () => void;
  onNext: () => void;
}) => {
  const configured = KREDITO_VAULT_ADDRESS.length > 0;
  const vault = configured ? (KREDITO_VAULT_ADDRESS as `0x${string}`) : undefined;
  const { writeContractSponsored, sendCalls } = useSponsoredWrite();

  // --- Onchain reads (Sepolia). Disabled until the vault address is configured. ---
  const { data: liquidity, refetch: refetchLiquidity } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "idleLiquidity",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: minScoreData } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "minScore",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: assetAddr } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "asset",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: openLoanId, refetch: refetchOpenLoan } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "openLoanOf",
    args: [borrower],
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured && borrower !== ZERO_ADDR },
  });
  const { data: decimalsData } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr },
  });
  const { data: symbolData } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr },
  });
  const hasOpenLoan = typeof openLoanId === "bigint" && openLoanId !== 0n;
  const { data: loanData, refetch: refetchLoan } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "getLoan",
    args: hasOpenLoan ? [openLoanId] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured && hasOpenLoan },
  });

  const dec = typeof decimalsData === "number" ? decimalsData : 6;
  const sym = typeof symbolData === "string" ? symbolData : "mUSDC";
  const liq = typeof liquidity === "bigint" ? Number(formatUnits(liquidity, dec)) : 0;
  const floor = typeof minScoreData === "bigint" ? Number(minScoreData) : DEMO_VAULT.minScore;
  const loan = loanData as VaultLoan | undefined;

  const score = att?.attestation.score ?? result?.combinedScore ?? 0;
  const limitUsd = result?.bureau.recommendedCreditLimitUsd ?? DEMO_VAULT.liquidityUsd;
  // Demo: 1 token unit (mUSDC) == $1, so borrowable = min(credit limit, pool liquidity).
  const maxBorrow = Math.max(0, Math.min(limitUsd, liq || limitUsd));

  const [amount, setAmount] = useState("");
  const [borrowing, setBorrowing] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const [loanTx, setLoanTx] = useState<{ hash: string; amount: string } | null>(null);
  // Expiry uses Date.now() (impure at render) → evaluate it in an effect.
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (maxBorrow > 0) setAmount(a => a || String(Math.floor(maxBorrow)));
  }, [maxBorrow]);

  useEffect(() => {
    setExpired(!!att && att.attestation.expiresAt <= Math.floor(Date.now() / 1000));
  }, [att]);

  // Mirrors the vault's isEligible (the contract is the real gate; this drives the UI).
  const eligible = !!att && att.attestation.score >= floor && att.attestation.riskTier !== 0 && !expired;

  const doBorrow = async () => {
    if (!vault || !att) {
      notification.error("Sign your credit attestation in the Certificate step first.");
      return;
    }
    let amt: bigint;
    try {
      amt = parseUnits((amount || "0").replace(/,/g, ""), dec);
    } catch {
      notification.error("Invalid amount.");
      return;
    }
    if (amt <= 0n) {
      notification.error("Enter an amount to borrow.");
      return;
    }
    setBorrowing(true);
    try {
      const hash = await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "borrow",
        args: [toTypedMessage(att.attestation), att.signature, amt],
      });
      setLoanTx({ hash, amount });
      notification.success("Loan disbursed onchain (gas-sponsored)");
      void refetchLiquidity();
      void refetchOpenLoan();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBorrowing(false);
    }
  };

  const doRepay = async () => {
    if (!vault || !assetAddr || !loan || typeof openLoanId !== "bigint") return;
    setRepaying(true);
    try {
      // Atomic approve + repay in one sponsored UserOperation.
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vault, loan.principal],
      });
      const repayData = encodeFunctionData({ abi: VAULT_ABI, functionName: "repay", args: [openLoanId] });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: vault, data: repayData },
      ]);
      notification.success("Loan repaid — capital returned to the pool");
      setLoanTx(null);
      void refetchLoan();
      void refetchOpenLoan();
      void refetchLiquidity();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setRepaying(false);
    }
  };

  return (
    <>
      <PageHeader
        step={4}
        eyebrow="Working-capital loan"
        title="Borrow against your attestation"
        subtitle="The vault verifies the issuer-signed attestation onchain (recover == issuer, score ≥ minimum, unexpired) and disburses an undercollateralized loan. Gas is sponsored."
      />

      {!configured ? (
        <Panel eyebrow="Onchain" title="Vault not configured">
          <p className="text-sm text-base-content/70">
            Deploy the vault and set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to enable onchain borrowing:
          </p>
          <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2 mt-2">
            yarn deploy --file DeployKreditoVault.s.sol --network sepolia
          </code>
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            <Stat label="Credit limit" value={formatUsd(limitUsd)} />
            <Stat label="Your score" value={String(score)} />
            <Stat label="Min score" value={String(DEMO_VAULT.minScore)} />
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel eyebrow="Onchain offer · Sepolia" title="Loan offer">
            <div className="grid sm:grid-cols-4 gap-4">
              <Stat label="Pool liquidity" value={`${formatUsd(liq)} ${sym}`} />
              <Stat label="Your score" value={String(score)} />
              <Stat label="Min score (onchain)" value={String(floor)} />
              <div>
                <p className="k-eyebrow mb-1">Eligibility</p>
                {att ? (
                  eligible ? (
                    <span className="badge badge-success gap-1">
                      <CheckCircleIcon className="h-3.5 w-3.5" /> Eligible
                    </span>
                  ) : (
                    <span className="badge badge-error">Not eligible</span>
                  )
                ) : (
                  <span className="badge badge-ghost">Sign first</span>
                )}
              </div>
            </div>
            {!att && (
              <div className="rounded-field bg-warning/10 text-warning text-xs px-3 py-2 mt-3">
                Sign your credit attestation in the Certificate step to borrow.
              </div>
            )}
          </Panel>

          {hasOpenLoan ? (
            <Panel eyebrow="Active loan" title={`Loan #${String(openLoanId)}`}>
              <div className="grid sm:grid-cols-2 gap-4">
                <Stat
                  label="Principal"
                  value={`${formatUsd(loan ? Number(formatUnits(loan.principal, dec)) : 0)} ${sym}`}
                />
                <Stat label="Status" value="Active" />
              </div>
              <button className="btn btn-outline btn-sm gap-1 mt-4" onClick={doRepay} disabled={repaying} type="button">
                {repaying ? (
                  <>
                    <span className="loading loading-spinner loading-xs" /> Repaying…
                  </>
                ) : (
                  <>Repay loan</>
                )}
              </button>
              <p className="text-xs text-base-content/50 mt-2">
                Repay batches approve + repay into one sponsored UserOperation.
              </p>
            </Panel>
          ) : (
            <Panel eyebrow="Draw" title="Borrow">
              <label className="block">
                <span className="k-eyebrow">Amount ({sym})</span>
                <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0"
                    className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
                  />
                  <button
                    type="button"
                    className="text-xs link shrink-0"
                    onClick={() => setAmount(String(Math.floor(maxBorrow)))}
                  >
                    Max {formatUsd(maxBorrow)}
                  </button>
                </div>
              </label>
              <button
                className="btn btn-primary btn-sm w-full gap-1 mt-3"
                onClick={doBorrow}
                disabled={borrowing || !att || !eligible}
                type="button"
              >
                {borrowing ? (
                  <>
                    <span className="loading loading-spinner loading-xs" /> Borrowing onchain…
                  </>
                ) : (
                  <>
                    <BanknotesIcon className="h-4 w-4" /> Borrow {sym} (sponsored)
                  </>
                )}
              </button>
              {loanTx && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center gap-2 text-success text-sm font-medium">
                    <CheckCircleIcon className="h-5 w-5" /> Disbursed {loanTx.amount} {sym}
                  </div>
                  <a
                    href={sepoliaTxUrl(loanTx.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="link k-mono text-xs break-all inline-flex items-center gap-1"
                  >
                    {loanTx.hash}
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </div>
              )}
            </Panel>
          )}
        </div>
      )}

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

const LiquiditySection = ({ borrower, onBack }: { borrower: `0x${string}`; onBack: () => void }) => {
  const configured = KREDITO_VAULT_ADDRESS.length > 0;
  const vault = configured ? (KREDITO_VAULT_ADDRESS as `0x${string}`) : undefined;
  const hasLp = configured && borrower !== ZERO_ADDR;
  const { writeContractSponsored, sendCalls } = useSponsoredWrite();

  const read = { address: vault, abi: VAULT_ABI, chainId: VAULT_CHAIN_ID } as const;

  const { data: assetAddr } = useReadContract({ ...read, functionName: "asset", query: { enabled: configured } });
  const { data: decimalsData } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr },
  });
  const { data: symbolData } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr },
  });
  const { data: walletBal, refetch: refetchWallet } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [borrower],
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!assetAddr && hasLp },
  });
  const { data: tvl, refetch: refetchTvl } = useReadContract({
    ...read,
    functionName: "totalAssets",
    query: { enabled: configured },
  });
  const { data: idle, refetch: refetchIdle } = useReadContract({
    ...read,
    functionName: "idleLiquidity",
    query: { enabled: configured },
  });
  const { data: lent } = useReadContract({ ...read, functionName: "totalOutstanding", query: { enabled: configured } });
  const { data: shares, refetch: refetchShares } = useReadContract({
    ...read,
    functionName: "balanceOf",
    args: [borrower],
    query: { enabled: hasLp },
  });
  const { data: positionValue } = useReadContract({
    ...read,
    functionName: "convertToAssets",
    args: [typeof shares === "bigint" ? shares : 0n],
    query: { enabled: hasLp && typeof shares === "bigint" && shares > 0n },
  });
  const { data: pendingShares, refetch: refetchPending } = useReadContract({
    ...read,
    functionName: "pendingRedeemRequest",
    args: [0n, borrower],
    query: { enabled: hasLp },
  });
  const { data: claimableShares, refetch: refetchClaimable } = useReadContract({
    ...read,
    functionName: "claimableRedeemRequest",
    args: [0n, borrower],
    query: { enabled: hasLp },
  });
  const { data: pendingValue } = useReadContract({
    ...read,
    functionName: "convertToAssets",
    args: [typeof pendingShares === "bigint" ? pendingShares : 0n],
    query: { enabled: hasLp && typeof pendingShares === "bigint" && pendingShares > 0n },
  });
  const { data: claimableValue } = useReadContract({
    ...read,
    functionName: "convertToAssets",
    args: [typeof claimableShares === "bigint" ? claimableShares : 0n],
    query: { enabled: hasLp && typeof claimableShares === "bigint" && claimableShares > 0n },
  });
  const { data: vaultOwner } = useReadContract({ ...read, functionName: "owner", query: { enabled: configured } });

  const dec = typeof decimalsData === "number" ? decimalsData : 6;
  const sym = typeof symbolData === "string" ? symbolData : "mUSDC";
  const usd = (v: unknown) => formatUsd(typeof v === "bigint" ? Number(formatUnits(v, dec)) : 0);
  const sharesBig = typeof shares === "bigint" ? shares : 0n;
  const positionBig = typeof positionValue === "bigint" ? positionValue : 0n;
  const pendingBig = typeof pendingShares === "bigint" ? pendingShares : 0n;
  const claimableBig = typeof claimableShares === "bigint" ? claimableShares : 0n;
  const isOwner = !!vaultOwner && String(vaultOwner).toLowerCase() === borrower.toLowerCase();

  const [amount, setAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [busy, setBusy] = useState<"" | "supply" | "request" | "cancel" | "claim" | "fulfill">("");

  const refetchAll = () => {
    void refetchWallet();
    void refetchTvl();
    void refetchIdle();
    void refetchShares();
    void refetchPending();
    void refetchClaimable();
  };

  const supply = async () => {
    if (!vault || !assetAddr) return;
    let amt: bigint;
    try {
      amt = parseUnits((amount || "0").replace(/,/g, ""), dec);
    } catch {
      notification.error("Invalid amount.");
      return;
    }
    if (amt <= 0n) {
      notification.error("Enter an amount to supply.");
      return;
    }
    setBusy("supply");
    try {
      // Atomic approve + deposit in one sponsored UserOperation (ERC-4626 sync deposit).
      const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, amt] });
      const depositData = encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [amt, borrower] });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: vault, data: depositData },
      ]);
      notification.success(`Supplied ${amount} ${sym} to the vault`);
      setAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  // Async redeem: requestRedeem escrows shares; the keeper fulfills as liquidity frees; then claim.
  const requestRedeem = async () => {
    if (!vault || positionBig <= 0n || sharesBig <= 0n) return;
    // Convert the asset-denominated input to shares pro-rata (blank = full position).
    let reqShares = sharesBig;
    const trimmed = (redeemAmount || "").replace(/,/g, "").trim();
    if (trimmed) {
      let amtAssets: bigint;
      try {
        amtAssets = parseUnits(trimmed, dec);
      } catch {
        notification.error("Invalid amount.");
        return;
      }
      reqShares = (amtAssets * sharesBig) / positionBig;
      if (reqShares > sharesBig) reqShares = sharesBig;
    }
    if (reqShares <= 0n) {
      notification.error("Amount too small.");
      return;
    }
    setBusy("request");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "requestRedeem",
        args: [reqShares, borrower, borrower],
      });
      notification.success("Redeem requested — awaiting keeper fulfillment");
      setRedeemAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const cancelRedeem = async () => {
    if (!vault || pendingBig <= 0n) return;
    setBusy("cancel");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "cancelRedeemRequest",
        args: [pendingBig, borrower],
      });
      notification.success("Pending redeem cancelled — shares returned");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const claimRedeem = async () => {
    if (!vault || claimableBig <= 0n) return;
    setBusy("claim");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "redeem",
        args: [claimableBig, borrower, borrower],
      });
      notification.success("Claimed — assets returned to your wallet");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  // Keeper/owner action: move a controller's pending redeem to claimable (locks rate, reserves assets).
  const fulfill = async () => {
    if (!vault || pendingBig <= 0n) return;
    setBusy("fulfill");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "fulfillRedeem",
        args: [borrower, pendingBig],
      });
      notification.success("Redeem fulfilled — now claimable");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <PageHeader
        step={5}
        eyebrow="Liquidity · ERC-4626 + ERC-7540"
        title="Provide liquidity to the vault"
        subtitle="LPs supply the asset and receive vault shares (ERC-4626). Because capital is lent out, redemptions are asynchronous (ERC-7540): request → the keeper fulfills as liquidity frees → claim. Gas is sponsored."
      />

      {!configured ? (
        <Panel eyebrow="Onchain" title="Vault not configured">
          <p className="text-sm text-base-content/70">
            Deploy the vault and set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to enable liquidity provision:
          </p>
          <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2 mt-2">
            yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
          </code>
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="k-card p-5">
              <p className="k-eyebrow mb-1">Total assets</p>
              <p className="k-mono text-2xl font-semibold">{usd(tvl)}</p>
            </div>
            <div className="k-card p-5">
              <p className="k-eyebrow mb-1">Idle (lendable)</p>
              <p className="k-mono text-2xl font-semibold">{usd(idle)}</p>
            </div>
            <div className="k-card p-5">
              <p className="k-eyebrow mb-1">Lent out</p>
              <p className="k-mono text-2xl font-semibold">{usd(lent)}</p>
            </div>
            <div className="k-card p-5">
              <p className="k-eyebrow mb-1">Your position</p>
              <p className="k-mono text-2xl font-semibold">{usd(positionBig)}</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {/* Supply */}
            <Panel eyebrow="Supply · ERC-4626" title="Provide liquidity">
              <label className="block">
                <span className="k-eyebrow">Amount ({sym})</span>
                <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0"
                    className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
                  />
                  <button
                    type="button"
                    className="text-xs link shrink-0"
                    onClick={() => setAmount(typeof walletBal === "bigint" ? formatUnits(walletBal, dec) : "")}
                  >
                    Max {usd(walletBal)}
                  </button>
                </div>
              </label>
              <button
                className="btn btn-primary btn-sm w-full gap-1 mt-3"
                onClick={supply}
                disabled={busy !== "" || !hasLp}
                type="button"
              >
                {busy === "supply" ? (
                  <>
                    <span className="loading loading-spinner loading-xs" /> Supplying…
                  </>
                ) : (
                  <>
                    <BanknotesIcon className="h-4 w-4" /> Supply {sym} (sponsored)
                  </>
                )}
              </button>
              <p className="text-xs text-base-content/50 mt-2">Batches approve + deposit into one sponsored call.</p>
            </Panel>

            {/* Async redeem */}
            <Panel eyebrow="Redeem · ERC-7540 async" title="Withdraw liquidity">
              {claimableBig > 0n && (
                <div className="rounded-field bg-success/10 px-3 py-2 mb-3">
                  <p className="text-sm font-medium text-success">Claimable: {usd(claimableValue)}</p>
                  <button
                    className="btn btn-success btn-sm w-full gap-1 mt-2"
                    onClick={claimRedeem}
                    disabled={busy !== ""}
                    type="button"
                  >
                    {busy === "claim" ? (
                      <>
                        <span className="loading loading-spinner loading-xs" /> Claiming…
                      </>
                    ) : (
                      <>Claim {usd(claimableValue)}</>
                    )}
                  </button>
                </div>
              )}

              {pendingBig > 0n ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-base-content/70">Pending redeem</span>
                    <span className="k-mono font-medium">{usd(pendingValue)}</span>
                  </div>
                  <p className="text-xs text-base-content/55">
                    Waiting for the keeper to fulfill as borrowers repay and liquidity frees up.
                  </p>
                  <button
                    className="btn btn-outline btn-sm w-full"
                    onClick={cancelRedeem}
                    disabled={busy !== ""}
                    type="button"
                  >
                    {busy === "cancel" ? (
                      <>
                        <span className="loading loading-spinner loading-xs" /> Cancelling…
                      </>
                    ) : (
                      <>Cancel pending request</>
                    )}
                  </button>
                  {isOwner && (
                    <button
                      className="btn btn-secondary btn-sm w-full"
                      onClick={fulfill}
                      disabled={busy !== ""}
                      type="button"
                    >
                      {busy === "fulfill" ? (
                        <>
                          <span className="loading loading-spinner loading-xs" /> Fulfilling…
                        </>
                      ) : (
                        <>Fulfill now (keeper)</>
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <label className="block">
                    <span className="k-eyebrow">Amount ({sym}) — blank = full position</span>
                    <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
                      <input
                        inputMode="decimal"
                        value={redeemAmount}
                        onChange={e => setRedeemAmount(e.target.value)}
                        placeholder={positionBig > 0n ? formatUnits(positionBig, dec) : "0"}
                        className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
                      />
                      <button
                        type="button"
                        className="text-xs link shrink-0"
                        onClick={() => setRedeemAmount(positionBig > 0n ? formatUnits(positionBig, dec) : "")}
                      >
                        Max {usd(positionBig)}
                      </button>
                    </div>
                  </label>
                  <button
                    className="btn btn-primary btn-sm w-full gap-1 mt-3"
                    onClick={requestRedeem}
                    disabled={busy !== "" || positionBig <= 0n}
                    type="button"
                  >
                    {busy === "request" ? (
                      <>
                        <span className="loading loading-spinner loading-xs" /> Requesting…
                      </>
                    ) : (
                      <>Request redeem</>
                    )}
                  </button>
                  <p className="text-xs text-base-content/50 mt-2">
                    Shares are escrowed now; the keeper fulfills, then you claim.
                  </p>
                </>
              )}
            </Panel>
          </div>
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
      </div>
    </>
  );
};
