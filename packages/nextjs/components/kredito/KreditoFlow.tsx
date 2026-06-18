"use client";

import { useEffect, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import { decodeEventLog, encodeFunctionData, formatUnits, parseUnits, recoverTypedDataAddress } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
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
import {
  CertificateCard,
  HashChip,
  type IdentityCardData,
  IdentityChip,
  KreditoIdentityCard,
  PageHeader,
  Panel,
  RiskBadge,
  ScoreMeter,
  SignalRow,
} from "~~/components/kredito";
import { RecentChecks } from "~~/components/kredito/RecentChecks";
import { useKreditoIdentity } from "~~/hooks/scaffold-eth/useKreditoIdentity";
import { useSmartWalletAddress, useSmartWalletSign, useSponsoredWrite } from "~~/hooks/scaffold-eth/useSmartWallet";
import { toTypedMessage, typedData } from "~~/kredito/attestation";
import { formatUsd } from "~~/kredito/format";
import { type StoredScore, saveScoreResult, toCertificate, toUiRiskTier } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import {
  ERC20_ABI,
  INSURANCE_POOL_ABI,
  KREDITO_INSURANCE_ADDRESS,
  KREDITO_VAULT_ADDRESS,
  LOAN_STATUS_LABEL,
  type SignedAttestation,
  VAULT_ABI,
  VAULT_CHAIN_ID,
  type VaultLoan,
  sepoliaTxUrl,
} from "~~/kredito/vault";
import { COUNTRIES, ENTERPRISE_TYPES } from "~~/lib/countries";
import {
  type EnsIdentity,
  PROFILE_FIELDS,
  type ProfileCol,
  type ProfileField,
  creditLimitUsd,
  editMessage,
  ensTextRecords,
  fullName,
  isHttpUrl,
  isTwitterHandle,
  kreditoResolverAbi,
  labelToNode,
  mintMessage,
  normalizeLabel,
  profileDigest,
  sanitizeProfile,
} from "~~/lib/kredito";
import type { UploadedDocument } from "~~/services/lendsignal/types";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

const STEPS = ["Onboarding", "Score", "Certificate", "Profile", "Borrow", "Liquidity"] as const;

const KREDITO_RESOLVER = (process.env.NEXT_PUBLIC_KREDITO_RESOLVER ?? "") as string;

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

// The onboarding form starts empty — the user enters their own business identity details.
type FormProfile = {
  legalName: string;
  country: string;
  enterpriseType: string;
  taxNumber: string;
  registryNumber: string;
};

const EMPTY_PROFILE: FormProfile = {
  legalName: "",
  country: "",
  enterpriseType: "",
  taxNumber: "",
  registryNumber: "",
};

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
      const completed = i < current && reachable;
      // Borrow + Liquidity require the deployed lending vault; flag them only when it is unconfigured.
      const comingSoon = i >= 4 && KREDITO_VAULT_ADDRESS.length === 0;
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
              active ? "bg-primary-content/20" : completed ? "bg-success text-success-content" : "bg-base-300"
            }`}
          >
            {completed ? <CheckIcon className="h-3 w-3" /> : i + 1}
          </span>
          {label}
          {comingSoon && (
            <span
              className={`badge badge-xs ${active ? "badge-ghost text-primary-content/80" : "badge-ghost text-base-content/50"}`}
            >
              soon
            </span>
          )}
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

const SelectField = ({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder: string;
}) => (
  <label className="block">
    <span className="k-eyebrow">{label}</span>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="select select-bordered mt-1 w-full text-sm font-normal"
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
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

// Live per-document analysis status, driven by the client polling loop.
type DocStatus = "queued" | "processing" | "completed" | "failed";
type DocProgress = { filename: string; status: DocStatus };
// "pending" → not started yet; "running" → reduce inference in flight; "done" → finished.
type ReducePhase = "pending" | "running" | "done";

/**
 * REAL per-document progress for the client-orchestrated map→reduce pipeline. Each document's
 * inference is submitted, then polled individually (queued → processing → completed/failed), so
 * this shows true live state instead of a time-based fake. The reduce step lights up only once
 * every document has completed.
 */
const AnalyzingProgress = ({ docs, reducePhase }: { docs: DocProgress[]; reducePhase: ReducePhase }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const clock = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(clock);
  }, []);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const completedCount = docs.filter(d => d.status === "completed").length;

  const DocIcon = ({ status }: { status: DocStatus }) => {
    if (status === "completed")
      return (
        <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-success text-success-content">
          <CheckIcon className="h-3 w-3" />
        </span>
      );
    if (status === "failed")
      return (
        <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-error text-error-content">
          <XMarkIcon className="h-3 w-3" />
        </span>
      );
    if (status === "processing")
      return (
        <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-primary/15">
          <span className="loading loading-spinner loading-xs text-primary" />
        </span>
      );
    // queued
    return (
      <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-base-300">
        <span className="loading loading-spinner loading-xs text-base-content/50" />
      </span>
    );
  };

  const STATUS_LABEL: Record<DocStatus, string> = {
    queued: "queued",
    processing: "analyzing…",
    completed: "done",
    failed: "failed",
  };

  return (
    <div className="k-card p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-md text-primary" />
          <p className="font-semibold">Analyzing in the Chainlink TEE…</p>
        </div>
        <span className="k-mono text-sm text-base-content/60 tabular-nums">{mmss}</span>
      </div>
      <p className="text-xs text-base-content/55 mb-4">
        Each of your {docs.length} document{docs.length === 1 ? "" : "s"} is analyzed privately inside the enclave, then
        reduced to a credit decision. This typically takes{" "}
        <span className="font-medium text-base-content/75">2–4 minutes</span> — keep this tab open.
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300 mb-4">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${docs.length ? Math.round((completedCount / docs.length) * 100) : 0}%` }}
        />
      </div>
      <ul className="space-y-2.5">
        {docs.map(d => (
          <li key={d.filename} className="flex items-center gap-3 text-sm">
            <DocIcon status={d.status} />
            <span className={`font-medium truncate ${d.status === "failed" ? "text-error" : ""}`}>{d.filename}</span>
            <span
              className={`ml-auto k-mono text-xs shrink-0 ${
                d.status === "completed"
                  ? "text-success"
                  : d.status === "failed"
                    ? "text-error"
                    : "text-base-content/50"
              }`}
            >
              {STATUS_LABEL[d.status]}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 text-sm">
          {reducePhase === "done" ? (
            <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-success text-success-content">
              <CheckIcon className="h-3 w-3" />
            </span>
          ) : reducePhase === "running" ? (
            <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-primary/15">
              <span className="loading loading-spinner loading-xs text-primary" />
            </span>
          ) : (
            <span className="grid place-items-center h-5 w-5 rounded-full shrink-0 bg-base-300 text-base-content/55 text-xs">
              ∑
            </span>
          )}
          <span className={reducePhase === "pending" ? "text-base-content/55" : "font-medium"}>
            Reduce to a final decision
            {reducePhase === "pending" ? " — runs once all documents finish" : reducePhase === "running" ? "…" : ""}
          </span>
        </li>
      </ul>
    </div>
  );
};

// ---------------------------------------------------------------- the flow

export const KreditoFlow = () => {
  const { address, isSmartWallet } = useKreditoWallet();
  // The connected wallet's Kredito ENSv2 identity (NOT mainnet ENS) — shown as a chip once minted.
  const { identity: walletIdentity } = useKreditoIdentity(address ?? undefined);

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  const [profile, setProfile] = useState<FormProfile>(EMPTY_PROFILE);
  const [docs, setDocs] = useState<Record<string, UploadedDocument | null>>({});
  const [submitting, setSubmitting] = useState(false);
  // REAL per-document analysis state + the reduce phase, driving AnalyzingProgress live.
  const [docProgress, setDocProgress] = useState<DocProgress[]>([]);
  const [reducePhase, setReducePhase] = useState<ReducePhase>("pending");
  const [result, setResult] = useState<StoredScore | null>(null);
  // The issuer-signed attestation, produced in the Certificate step and consumed by Borrow.
  const [att, setAtt] = useState<SignedAttestation | null>(null);
  // The minted identity label, lifted from CertificateSection so the Profile step can resolve it.
  const [mintedLabel, setMintedLabel] = useState<string | null>(null);

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

  // Client-orchestrated map→reduce: (1) submit one inference per doc, (2) poll each to a terminal
  // state with REAL per-doc UI, (3) reduce + persist via /finish. No single request runs for minutes,
  // so neither the UI spinner nor the Vercel serverless timeout can stall. On any failure we surface
  // a clear error and stop — the form + uploads are kept so the user can retry.
  const runCreditCheck = async () => {
    if (
      !profile.legalName.trim() ||
      !profile.country.trim() ||
      !profile.enterpriseType.trim() ||
      !profile.taxNumber.trim() ||
      !profile.registryNumber.trim()
    ) {
      notification.error("Complete all business fields: legal name, country, type, tax number, registry number.");
      return;
    }
    if (uploadedDocs.length === 0) {
      notification.error("Upload at least one business document to run the credit check.");
      return;
    }

    const apiProfile = {
      legalName: profile.legalName,
      country: profile.country,
      enterpriseType: profile.enterpriseType,
      taxNumber: profile.taxNumber,
      registryNumber: profile.registryNumber,
    };

    setSubmitting(true);
    setReducePhase("pending");
    setDocProgress(uploadedDocs.map(d => ({ filename: d.filename, status: "queued" })));

    try {
      // --- Step 1: submit one inference per document (fast; returns ids only) ---
      const submitRes = await fetch("/api/lendsignal/score/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: apiProfile, documents: uploadedDocs }),
      });
      const submitJson = await submitRes.json();
      if (!submitRes.ok)
        throw new Error(submitJson?.message || submitJson?.error || "Failed to submit credit analysis");
      const submitted = submitJson.docs as {
        filename: string;
        type: string;
        prompt: string;
        systemPrompt: string;
        inferenceId: string;
      }[];

      // --- Step 2: poll each inference until completed/failed. ~6-min overall safety cap. ---
      const POLL_MS = 3000;
      const DEADLINE = Date.now() + 6 * 60 * 1000;
      const setStatus = (filename: string, status: DocStatus) =>
        setDocProgress(prev => prev.map(d => (d.filename === filename ? { ...d, status } : d)));

      const pending = new Set(submitted.map(d => d.filename));
      const failed: string[] = [];

      while (pending.size > 0) {
        if (Date.now() > DEADLINE) {
          throw new Error("Credit analysis timed out — the documents didn't finish in time. Please retry.");
        }
        await new Promise(r => setTimeout(r, POLL_MS));
        await Promise.all(
          submitted
            .filter(d => pending.has(d.filename))
            .map(async d => {
              try {
                const r = await fetch(`/api/lendsignal/inference/${d.inferenceId}`);
                const snap = await r.json();
                if (!r.ok) return; // transient lookup error — keep polling
                const status = snap?.status as string | undefined;
                if (status === "completed") {
                  setStatus(d.filename, "completed");
                  pending.delete(d.filename);
                } else if (status === "failed") {
                  setStatus(d.filename, "failed");
                  pending.delete(d.filename);
                  failed.push(d.filename);
                } else {
                  setStatus(d.filename, "processing");
                }
              } catch {
                // transient network error — keep polling
              }
            }),
        );
      }

      if (failed.length > 0) {
        throw new Error(`Credit analysis failed for: ${failed.join(", ")}. Please retry.`);
      }

      // --- Step 3: reduce + persist, then surface the StoredScore ---
      setReducePhase("running");
      const finishRes = await fetch("/api/lendsignal/score/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: apiProfile,
          borrower: address,
          docs: submitted.map(d => ({
            filename: d.filename,
            type: d.type,
            prompt: d.prompt,
            systemPrompt: d.systemPrompt,
            inferenceId: d.inferenceId,
          })),
        }),
      });
      const finishJson = await finishRes.json();
      if (!finishRes.ok) throw new Error(finishJson?.message || finishJson?.error || "Scoring failed");

      setReducePhase("done");
      setResult(finishJson as StoredScore);
      saveScoreResult(finishJson);
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
          {submitting && <AnalyzingProgress docs={docProgress} reducePhase={reducePhase} />}
          <div className={submitting ? "hidden" : "grid lg:grid-cols-3 gap-5"}>
            <div className="lg:col-span-2 space-y-5">
              <Panel eyebrow="Business profile" title="Company information">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Legal name" value={profile.legalName} onChange={set("legalName")} />
                  <SelectField
                    label="Country"
                    value={profile.country}
                    onChange={set("country")}
                    options={COUNTRIES}
                    placeholder="Select a country"
                  />
                  <SelectField
                    label="Type of enterprise"
                    value={profile.enterpriseType}
                    onChange={set("enterpriseType")}
                    options={ENTERPRISE_TYPES}
                    placeholder="Select a type"
                  />
                  <Field label="Tax number" value={profile.taxNumber} onChange={set("taxNumber")} />
                  <Field label="Registry number" value={profile.registryNumber} onChange={set("registryNumber")} />
                </div>
              </Panel>

              <Panel
                eyebrow="Evidence"
                title="Upload documents"
                action={
                  <span className="k-mono text-xs text-base-content/55">
                    {uploadedDocs.length}/{REQUIRED_DOCS.length}
                  </span>
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
                  Upload your own business documents. Prefer small <code>.txt</code>/<code>.png</code>/<code>.pdf</code>{" "}
                  files (faster TEE preprocessing). Raw files never leave the enclave or go onchain — only the attested
                  score does.
                </p>
              </Panel>
            </div>

            <div className="space-y-5">
              <Panel eyebrow="Wallet" title="Credit identity">
                {address ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-2 w-2 rounded-full bg-success" />
                      {isSmartWallet ? "Smart wallet connected" : "Wallet connected"}
                    </div>
                    {walletIdentity && <IdentityChip identity={walletIdentity} />}
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
          legalName={profile.legalName}
          att={att}
          setAtt={setAtt}
          onMinted={setMintedLabel}
          onBack={() => setStep(1)}
          onNext={() => advance(3)}
        />
      )}

      {/* STEP 4 — PROFILE (public credit identity setup) */}
      {step === 3 && (
        <ProfileSection
          borrower={(address ?? ZERO_ADDR) as `0x${string}`}
          mintedLabel={mintedLabel}
          onBack={() => setStep(2)}
          onNext={() => advance(4)}
        />
      )}

      {/* STEP 5 — BORROW (onchain) */}
      {step === 4 && (
        <BorrowSection
          result={result}
          borrower={(address ?? ZERO_ADDR) as `0x${string}`}
          att={att}
          onBack={() => setStep(3)}
          onNext={() => advance(5)}
        />
      )}

      {/* STEP 6 — LIQUIDITY (ERC-4626 + ERC-7540 async redeem) */}
      {step === 5 && <LiquiditySection borrower={(address ?? ZERO_ADDR) as `0x${string}`} onBack={() => setStep(4)} />}
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
  legalName,
  att,
  setAtt,
  onMinted,
  onBack,
  onNext,
}: {
  result: StoredScore;
  borrower: `0x${string}`;
  legalName: string;
  att: SignedAttestation | null;
  setAtt: (a: SignedAttestation | null) => void;
  onMinted: (label: string) => void;
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
  const [label, setLabel] = useState(() => safeLabel(legalName));
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
      onMinted(normalized);
      notification.success(`Minted ${fullName(normalized)}`);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  // Option B: the issuer SIGNS an EIP-712 attestation; the vault verifies it onchain.
  const signAttestation = async () => {
    // No user-entered loan amount — the credit limit (maxPrincipal) is derived from the score.
    const limitUsd = creditLimitUsd(result.combinedScore);
    if (limitUsd <= 0) {
      notification.error("Your credit score is below the eligible threshold for a credit line.");
      return;
    }
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
          // H-2: issuer-bound loan cap = the borrower's requested loan amount. The demo asset is
          // 6-decimal mUSDC where 1 unit == $1, so USD maps directly to base units. The vault
          // enforces borrow amount <= this.
          maxPrincipal: (BigInt(limitUsd) * 1_000_000n).toString(),
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
                <button className="btn btn-primary btn-sm w-full gap-1" onClick={onNext} type="button">
                  Continue to profile setup <ArrowRightIcon className="h-4 w-4" />
                </button>
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
        <button className="btn btn-primary gap-1" onClick={onNext} type="button" disabled={!minted}>
          {minted ? "Continue to profile setup" : "Mint your identity to continue"}{" "}
          <ArrowRightIcon className="h-4 w-4" />
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

const blockscoutAddressUrl = (addr: string) => `https://eth-sepolia.blockscout.com/address/${addr}`;

const ProfileSection = ({
  borrower,
  mintedLabel,
  onBack,
  onNext,
}: {
  borrower: `0x${string}`;
  mintedLabel: string | null;
  onBack: () => void;
  onNext: () => void;
}) => {
  const signMessage = useSmartWalletSign();
  const { writeContractSponsored } = useSponsoredWrite();
  const resolverConfigured = KREDITO_RESOLVER.length > 0;

  const [identity, setIdentity] = useState<EnsIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState<string | null>(mintedLabel);
  const [form, setForm] = useState<Record<ProfileCol, string>>(
    () => Object.fromEntries(PROFILE_FIELDS.map(f => [f.col, ""])) as Record<ProfileCol, string>,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setField = (col: ProfileCol, v: string) => setForm(p => ({ ...p, [col]: v }));

  // Resolve the minted identity: prefer the lifted label; otherwise look it up by wallet.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let id: EnsIdentity | null = null;
        if (mintedLabel) {
          const r = await fetch(`/api/identity/${encodeURIComponent(mintedLabel)}`);
          if (r.ok) id = (await r.json()).identity as EnsIdentity;
        }
        if (!id && borrower !== ZERO_ADDR) {
          const r = await fetch(`/api/identity/lookup?wallet=${borrower}`);
          if (r.ok) {
            const j = await r.json();
            if (j?.hasIdentity && j.identity) id = j.identity as EnsIdentity;
          }
        }
        if (cancelled) return;
        setIdentity(id);
        if (id) {
          setLabel(id.label);
          setForm(
            Object.fromEntries(PROFILE_FIELDS.map(f => [f.col, (id[f.col] as string | null) ?? ""])) as Record<
              ProfileCol,
              string
            >,
          );
        }
      } catch {
        // Non-fatal — the form still renders empty so the user can fill it in.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [mintedLabel, borrower]);

  const save = async () => {
    if (!label) {
      notification.error("No minted identity found. Mint your kredito.eth name first.");
      return;
    }
    setSaving(true);
    try {
      const clean = sanitizeProfile(form);
      const node = labelToNode(label);
      const { keys, values } = ensTextRecords(clean);

      // Canonical onchain write: resolver.setTexts (owner-gated, gas-sponsored) — when configured.
      if (resolverConfigured && keys.length > 0) {
        await writeContractSponsored({
          address: KREDITO_RESOLVER as `0x${string}`,
          abi: kreditoResolverAbi,
          functionName: "setTexts",
          args: [node, keys, values],
        });
      }

      // Mirror to Supabase for fast card rendering. The PATCH route requires a content-bound,
      // TTL'd editMessage signature proving wallet control (see app/api/identity/[label]/route.ts).
      const issuedAt = Date.now();
      const signature = await signMessage(editMessage(borrower, label, profileDigest(clean), issuedAt));
      const res = await fetch(`/api/identity/${encodeURIComponent(label)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: borrower, profile: form, issuedAt, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Save failed");
      setIdentity(json.identity as EnsIdentity);
      setSaved(true);
      notification.success(
        resolverConfigured ? "Profile saved onchain and mirrored" : "Profile saved (Supabase mirror)",
      );
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const displayName = label ? fullName(label) : "your credit identity";
  const attestationHash = identity?.attestation_hash ?? null;
  const txHash = identity?.tx_hash ?? null;

  // Live preview identity built from the current form state — drives the card on the right as the
  // user types. Status is "approved" (the issuer-locked credential is already minted at this step).
  const previewIdentity: IdentityCardData = {
    label: label ?? "yourname",
    full_name: identity?.full_name ?? null,
    status: "approved",
    display_name: form.display_name || null,
    description: form.description || null,
    avatar_url: form.avatar_url || null,
    header_url: form.header_url || null,
    url: form.url || null,
    location: form.location || null,
    twitter: form.twitter || null,
    github: form.github || null,
    telegram: form.telegram || null,
    discord: form.discord || null,
    linkedin: form.linkedin || null,
    email: form.email || null,
    attestation_hash: attestationHash,
  };

  // Soft validation hint (warn, don't block) for a single field based on its value + kind.
  const fieldWarning = (col: ProfileCol, kind: ProfileField["kind"], v: string): string | null => {
    const t = v.trim();
    if (!t) return null;
    if (kind === "url" && !isHttpUrl(t)) return "Enter a full https:// URL";
    if ((col === "twitter" || col === "github") && !isTwitterHandle(t)) return "Use a plain handle (no @ or spaces)";
    return null;
  };

  return (
    <>
      <PageHeader
        step={4}
        eyebrow="Credit identity · profile"
        title="Set up your public profile"
        subtitle="Your kredito.eth identity is a publicly-resolvable onchain credit credential. Add a public profile so anyone can verify your business — the approved status and attestation are issuer-locked and cannot be edited."
      />

      {/* VERIFIED CREDENTIAL HEADER — the publicly-exposed proof of credit */}
      <Panel
        eyebrow="Verified credential"
        title={<span className="k-mono">{displayName}</span>}
        className="mb-5"
        action={
          <span className="badge badge-success gap-1">
            <ShieldCheckIcon className="h-3.5 w-3.5" /> Verified · Approved
          </span>
        }
      >
        <p className="text-sm text-base-content/70">
          This is a publicly-resolvable onchain credit credential. The issuer wrote a locked <code>kredito.status</code>{" "}
          of <span className="k-mono">approved</span> — anyone can verify it without trusting us. You own the name and
          control your profile records, but not the credit status.
        </p>
        {attestationHash && (
          <div className="mt-4">
            <p className="k-eyebrow mb-1">Attestation hash</p>
            <HashChip value={attestationHash} lead={10} tail={8} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {label && (
            <a
              href={`/identity/${label}`}
              target="_blank"
              rel="noreferrer"
              className="link inline-flex items-center gap-1"
            >
              View public card
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
          {txHash && (
            <a
              href={sepoliaTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              className="link inline-flex items-center gap-1"
            >
              Mint transaction
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
          {resolverConfigured && (
            <a
              href={blockscoutAddressUrl(KREDITO_RESOLVER)}
              target="_blank"
              rel="noreferrer"
              className="link inline-flex items-center gap-1"
            >
              Resolver on Blockscout
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </Panel>

      {loading ? (
        <Panel eyebrow="Public profile" title="Edit your profile">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" /> Loading your identity…
          </div>
        </Panel>
      ) : !label ? (
        <Panel eyebrow="Public profile" title="Edit your profile">
          <p className="text-sm text-base-content/65">
            No minted identity was found for this wallet. Go back and mint your{" "}
            <span className="k-mono">.kredito.eth</span> name first.
          </p>
        </Panel>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          {/* Left: the editable form */}
          <Panel eyebrow="Public profile" title="Edit your profile">
            {!resolverConfigured && (
              <div className="alert alert-warning mb-4">
                <span className="text-sm">
                  Resolver not configured (<code>NEXT_PUBLIC_KREDITO_RESOLVER</code> is unset). Onchain text records are
                  skipped — your profile will be saved to the Supabase mirror only.
                </span>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              {PROFILE_FIELDS.map(f => {
                const warning = fieldWarning(f.col, f.kind, form[f.col]);
                return (
                  <label key={f.col} className={f.col === "description" ? "sm:col-span-2 block" : "block"}>
                    <span className="k-eyebrow">{f.label}</span>
                    {f.col === "description" ? (
                      <textarea
                        className="mt-1 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2.5 text-sm outline-none focus:border-primary transition-colors"
                        rows={3}
                        placeholder={f.placeholder}
                        value={form[f.col]}
                        onChange={e => setField(f.col, e.target.value)}
                      />
                    ) : (
                      <input
                        className={`mt-1 w-full rounded-field border bg-base-100 px-3 py-2.5 text-sm outline-none transition-colors ${
                          warning ? "border-warning focus:border-warning" : "border-base-300 focus:border-primary"
                        }`}
                        placeholder={f.placeholder}
                        value={form[f.col]}
                        onChange={e => setField(f.col, e.target.value)}
                      />
                    )}
                    {warning && <span className="mt-1 block text-xs text-warning">{warning}</span>}
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-sm gap-1" onClick={save} disabled={saving} type="button">
                {saving ? (
                  <>
                    <span className="loading loading-spinner loading-xs" /> Saving…
                  </>
                ) : (
                  <>
                    <ShieldCheckIcon className="h-4 w-4" />
                    {resolverConfigured ? "Save profile (onchain · sponsored)" : "Save profile (mirror)"}
                  </>
                )}
              </button>
              {saved && label && (
                <a
                  href={`/identity/${label}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-sm inline-flex items-center gap-1"
                >
                  View public profile
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {saved && (
              <div className="mt-4 rounded-field bg-success/10 px-4 py-3">
                <p className="text-sm font-medium text-success inline-flex items-center gap-1.5">
                  <CheckCircleIcon className="h-5 w-5" /> Profile saved
                </p>
                <p className="mt-1 text-sm text-base-content/65">
                  Your public credit card is live. Next up is borrowing against your attestation — launching when the
                  lending vault goes live.
                </p>
                <button className="btn btn-primary btn-sm gap-1 mt-3" onClick={onNext} type="button">
                  Continue to borrow <ArrowRightIcon className="h-4 w-4" />
                </button>
              </div>
            )}
            {resolverConfigured && (
              <p className="mt-3 text-xs text-base-content/50">
                <code>setTexts</code> writes your ENS text records through the owner-gated resolver (gas sponsored),
                then the Supabase mirror is updated with a content-bound signature so the public card renders fast.
              </p>
            )}
          </Panel>

          {/* Right: live preview of the public card as the user types */}
          <div className="space-y-2 lg:sticky lg:top-4">
            <p className="k-eyebrow">Live preview · public card</p>
            <KreditoIdentityCard identity={previewIdentity} preview />
          </div>
        </div>
      )}

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

// Equal-principal amortization preview (mirrors the vault: principal/term per installment +
// interest on the OUTSTANDING balance; the final installment clears the remainder).
const amortizationPreview = (principalUnits: bigint, termMonths: number, annualRateBps: number) => {
  if (principalUnits <= 0n || termMonths <= 0) return null;
  const term = BigInt(termMonths);
  const perInstallment = principalUnits / term;
  // First installment interest (interest on the full balance) — the headline "≈ /mo".
  const firstInterest = (principalUnits * BigInt(annualRateBps)) / (10_000n * 12n);
  const firstPayment = perInstallment + firstInterest;
  // Total interest across the schedule (sum over a declining balance).
  let outstanding = principalUnits;
  let totalInterest = 0n;
  for (let i = 0; i < termMonths; i++) {
    const interest = (outstanding * BigInt(annualRateBps)) / (10_000n * 12n);
    totalInterest += interest;
    const principalDue = i + 1 >= termMonths || perInstallment > outstanding ? outstanding : perInstallment;
    outstanding -= principalDue;
  }
  return { perInstallment, firstInterest, firstPayment, totalInterest };
};

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
  // The SMART WALLET is the borrower: it signs the attestation's `borrower` field, receives the
  // disbursement and pays installments. Reads are scoped to it so balances reflect the smart account.
  const smartWallet = useSmartWalletAddress();
  const account = smartWallet ?? (borrower !== ZERO_ADDR ? borrower : undefined);
  const publicClient = usePublicClient({ chainId: VAULT_CHAIN_ID });

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
  const { data: minTermData } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "MIN_TERM_MONTHS",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
  });
  const { data: maxTermData } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "MAX_TERM_MONTHS",
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured },
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

  const dec = typeof decimalsData === "number" ? decimalsData : 6;
  const sym = typeof symbolData === "string" ? symbolData : "USDC";
  const liqUnits = typeof liquidity === "bigint" ? liquidity : 0n;
  const liq = Number(formatUnits(liqUnits, dec));
  const minScore = result?.minEligibleScore ?? 600;
  const floor = typeof minScoreData === "bigint" ? Number(minScoreData) : minScore;
  const minTerm = typeof minTermData === "bigint" ? Number(minTermData) : 6;
  const maxTerm = typeof maxTermData === "bigint" ? Number(maxTermData) : 36;

  const score = att?.attestation.score ?? result?.combinedScore ?? 0;
  // The vault locks the APR by attestation riskTier (2/low -> tierToRateBps[1]=10%; 1/medium ->
  // tierToRateBps[2]=14%). Default rates mirror the vault constructor; the schedule is illustrative.
  const annualRateBps = att?.attestation.riskTier === 2 ? 1000 : att?.attestation.riskTier === 1 ? 1400 : 0;
  // The attestation's maxPrincipal is the score-derived credit limit (base units, USDC 6-decimals).
  const limitUnits = att ? att.attestation.maxPrincipal : 0n;
  const limitUsd = Number(formatUnits(limitUnits, dec));
  // Borrowable cap = min(credit limit, idle liquidity).
  const maxBorrowUnits = limitUnits < liqUnits ? limitUnits : liqUnits;
  const maxBorrow = Number(formatUnits(maxBorrowUnits, dec));

  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState(minTerm);
  const [borrowing, setBorrowing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [loanId, setLoanId] = useState<bigint | null>(null);
  const [loanTx, setLoanTx] = useState<{ hash: string; amount: string } | null>(null);
  // Expiry uses Date.now() (impure at render) → evaluate it in an effect.
  const [expired, setExpired] = useState(false);

  // Read the originated loan once we know its id.
  const { data: loanData, refetch: refetchLoan } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "getLoan",
    args: loanId !== null ? [loanId] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: configured && loanId !== null },
  });
  const loan = loanData as VaultLoan | undefined;

  useEffect(() => {
    setTerm(t => (t < minTerm ? minTerm : t > maxTerm ? maxTerm : t));
  }, [minTerm, maxTerm]);

  useEffect(() => {
    if (maxBorrow > 0) setAmount(a => a || String(Math.floor(maxBorrow)));
  }, [maxBorrow]);

  useEffect(() => {
    setExpired(!!att && att.attestation.expiresAt <= Math.floor(Date.now() / 1000));
  }, [att]);

  // Mirrors the vault's isEligible (the contract is the real gate; this drives the UI).
  const eligible = !!att && att.attestation.score >= floor && att.attestation.riskTier !== 0 && !expired;
  const noLiquidity = configured && liqUnits === 0n;

  // The amount the user typed, in base units (for the preview + the borrow tx).
  const parsedAmount = (() => {
    try {
      return parseUnits((amount || "0").replace(/,/g, ""), dec);
    } catch {
      return 0n;
    }
  })();
  const preview = amortizationPreview(parsedAmount, term, annualRateBps);

  // The next installment's amount (principal + interest [+ late fee]) for the approve+pay batch.
  // We add a small headroom for the optional 5% grace late fee so the approval always covers it.
  const installmentDue = (() => {
    if (!loan || loan.principal <= 0n) return 0n;
    const interest = (loan.principal * loan.annualRateBps) / (10_000n * 12n);
    const isLast = loan.paymentsMade + 1n >= loan.termMonths || loan.principalPerInstallment > loan.principal;
    const principalDue = isLast ? loan.principal : loan.principalPerInstallment;
    const base = principalDue + interest;
    // Cover a possible 5% late fee (grace) so the single approval never under-approves.
    return base + (base * 500n) / 10_000n;
  })();

  const doBorrow = async () => {
    if (!vault || !att) {
      notification.error("Sign your credit attestation in the Certificate step first.");
      return;
    }
    if (parsedAmount <= 0n) {
      notification.error("Enter an amount to borrow.");
      return;
    }
    if (parsedAmount > att.attestation.maxPrincipal) {
      notification.error("Amount exceeds your credit limit.");
      return;
    }
    if (parsedAmount > liqUnits) {
      notification.error("Amount exceeds available pool liquidity.");
      return;
    }
    if (term < minTerm || term > maxTerm) {
      notification.error(`Term must be between ${minTerm} and ${maxTerm} months.`);
      return;
    }
    setBorrowing(true);
    try {
      const hash = await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "borrow",
        args: [toTypedMessage(att.attestation), att.signature, parsedAmount, BigInt(term)],
      });
      setLoanTx({ hash, amount });
      notification.success("Loan disbursed onchain (gas-sponsored)");

      // Recover the loanId from the LoanIssued event in the tx receipt (the borrow return value is
      // not surfaced by a UserOperation, so decode the emitted event instead).
      try {
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        const issued = receipt?.logs
          .map(log => {
            try {
              return decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
            } catch {
              return null;
            }
          })
          .find(d => d?.eventName === "LoanIssued");
        if (issued && "args" in issued) {
          const id = (issued.args as { loanId: bigint }).loanId;
          setLoanId(id);
        }
      } catch {
        // Best-effort — the schedule panel just won't auto-show; reads still recover on next render.
      }
      void refetchLiquidity();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBorrowing(false);
    }
  };

  const doPay = async () => {
    if (!vault || !assetAddr || !loan || loanId === null || installmentDue <= 0n) return;
    setPaying(true);
    try {
      // Atomic approve + makePayment in one sponsored UserOperation.
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vault, installmentDue],
      });
      const payData = encodeFunctionData({ abi: VAULT_ABI, functionName: "makePayment", args: [loanId] });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: vault, data: payData },
      ]);
      notification.success("Installment paid — principal reduced");
      void refetchLoan();
      void refetchLiquidity();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setPaying(false);
    }
  };

  const hasActiveLoan = !!loan && (loan.status === 1 || loan.status === 2);

  return (
    <>
      <PageHeader
        step={5}
        eyebrow="Working-capital loan"
        title="Borrow against your attestation"
        subtitle="The vault verifies the issuer-signed attestation onchain (recover == issuer, score ≥ minimum, unexpired) and disburses an undercollateralized installment loan. Gas is sponsored."
      />

      {!configured ? (
        <>
          <div className="alert alert-info mb-5">
            <BanknotesIcon className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Lending vault not configured</p>
              <p className="text-sm opacity-80">
                Set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to the deployed vault to enable onchain borrowing.
              </p>
            </div>
          </div>
          <Panel eyebrow="Onchain" title="Vault not configured">
            <p className="text-sm text-base-content/70">
              Deploy the vault and set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to enable onchain borrowing:
            </p>
            <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2 mt-2">
              yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
            </code>
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <Stat label="Credit limit" value={formatUsd(limitUsd)} />
              <Stat label="Your score" value={String(score)} />
              <Stat label="Min score" value={String(minScore)} />
            </div>
          </Panel>
        </>
      ) : (
        <div className="space-y-4">
          <Panel eyebrow="Onchain offer · Sepolia" title="Loan offer">
            <div className="grid sm:grid-cols-4 gap-4">
              <Stat label="Pool liquidity" value={`${formatUsd(liq)} ${sym}`} />
              <Stat label="Credit limit" value={formatUsd(limitUsd)} />
              <Stat label="Your score" value={String(score)} />
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
            {att && noLiquidity && (
              <div className="rounded-field bg-warning/10 text-warning text-xs px-3 py-2 mt-3">
                No liquidity yet — supply via the Liquidity step first, then borrow.
              </div>
            )}
          </Panel>

          {hasActiveLoan ? (
            <Panel
              eyebrow="Active loan"
              title={`Loan #${loanId !== null ? String(loanId) : "—"}`}
              action={
                <span className={`badge ${loan?.status === 2 ? "badge-warning" : "badge-success"}`}>
                  {LOAN_STATUS_LABEL[loan?.status ?? 1]}
                </span>
              }
            >
              <div className="grid sm:grid-cols-4 gap-4">
                <Stat
                  label="Outstanding"
                  value={`${formatUsd(loan ? Number(formatUnits(loan.principal, dec)) : 0)} ${sym}`}
                />
                <Stat
                  label="Original"
                  value={`${formatUsd(loan ? Number(formatUnits(loan.originalPrincipal, dec)) : 0)} ${sym}`}
                />
                <Stat
                  label="Payments"
                  value={loan ? `${String(loan.paymentsMade)} / ${String(loan.termMonths)}` : "—"}
                />
                <Stat label="APR" value={loan ? `${Number(loan.annualRateBps) / 100}%` : "—"} />
              </div>
              <div className="mt-4 rounded-field border border-base-300 px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="k-eyebrow mb-0.5">Next installment (max)</p>
                  <p className="k-mono text-lg font-semibold">
                    {formatUsd(Number(formatUnits(installmentDue, dec)))} {sym}
                  </p>
                  <p className="text-xs text-base-content/50">principal + interest (incl. grace late-fee headroom)</p>
                </div>
                <button className="btn btn-primary btn-sm gap-1" onClick={doPay} disabled={paying} type="button">
                  {paying ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Paying…
                    </>
                  ) : (
                    <>Pay installment (sponsored)</>
                  )}
                </button>
              </div>
              <p className="text-xs text-base-content/50 mt-2">
                Pay batches approve + makePayment into one sponsored UserOperation.
              </p>
              {loanTx && (
                <a
                  href={sepoliaTxUrl(loanTx.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="link k-mono text-xs break-all inline-flex items-center gap-1 mt-2"
                >
                  Origination tx <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
                </a>
              )}
            </Panel>
          ) : (
            <Panel eyebrow="Draw" title="Borrow">
              <div className="grid sm:grid-cols-2 gap-4">
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
                <label className="block">
                  <span className="k-eyebrow">
                    Term — {minTerm}–{maxTerm} months
                  </span>
                  <select
                    value={term}
                    onChange={e => setTerm(Number(e.target.value))}
                    className="select select-bordered mt-1 w-full text-sm font-normal"
                  >
                    {Array.from({ length: Math.max(0, maxTerm - minTerm + 1) }, (_, i) => minTerm + i).map(m => (
                      <option key={m} value={m}>
                        {m} months
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {preview && (
                <div className="mt-4 rounded-field border border-base-300 bg-base-200/40 px-4 py-3">
                  <p className="k-eyebrow mb-2">Amortization preview · equal-principal</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-base-content/55">First payment</p>
                      <p className="k-mono font-semibold">
                        {formatUsd(Number(formatUnits(preview.firstPayment, dec)))} {sym}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">Principal / mo</p>
                      <p className="k-mono font-semibold">
                        {formatUsd(Number(formatUnits(preview.perInstallment, dec)))} {sym}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">APR (locked by tier)</p>
                      <p className="k-mono font-semibold">{annualRateBps / 100}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">Total interest</p>
                      <p className="k-mono font-semibold">
                        {formatUsd(Number(formatUnits(preview.totalInterest, dec)))} {sym}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-base-content/50 mt-2">
                    Equal principal of {formatUsd(Number(formatUnits(preview.perInstallment, dec)))} {sym} per month
                    plus interest on the declining balance; the final installment clears the remainder.
                  </p>
                </div>
              )}

              <button
                className="btn btn-primary btn-sm w-full gap-1 mt-3"
                onClick={doBorrow}
                disabled={borrowing || !att || !eligible || noLiquidity || parsedAmount <= 0n}
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
              {account && (
                <p className="text-xs text-base-content/45 mt-2">
                  Disbursed to your smart wallet <span className="k-mono">{account}</span>.
                </p>
              )}
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <button className="btn btn-outline gap-1" onClick={onNext} type="button">
          Go to liquidity <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};

const LiquiditySection = ({ borrower, onBack }: { borrower: `0x${string}`; onBack: () => void }) => {
  const configured = KREDITO_VAULT_ADDRESS.length > 0;
  const vault = configured ? (KREDITO_VAULT_ADDRESS as `0x${string}`) : undefined;
  const insuranceConfigured = KREDITO_INSURANCE_ADDRESS.length > 0;
  const insurance = insuranceConfigured ? (KREDITO_INSURANCE_ADDRESS as `0x${string}`) : undefined;
  const { writeContractSponsored, sendCalls } = useSponsoredWrite();

  // The connected SMART WALLET is the LP: it holds the USDC, receives shares, and is the redeem
  // controller. All position reads are scoped to it (not the embedded EOA).
  const smartWallet = useSmartWalletAddress();
  const lp = smartWallet ?? (borrower !== ZERO_ADDR ? borrower : undefined);
  const hasLp = configured && !!lp;

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
  // The smart wallet's USDC balance — it MUST hold USDC to supply.
  const { data: walletBal, refetch: refetchWallet } = useReadContract({
    address: assetAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: lp ? [lp] : undefined,
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
    args: lp ? [lp] : undefined,
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
    args: lp ? [0n, lp] : undefined,
    query: { enabled: hasLp },
  });
  const { data: claimableShares, refetch: refetchClaimable } = useReadContract({
    ...read,
    functionName: "claimableRedeemRequest",
    args: lp ? [0n, lp] : undefined,
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

  // --- Insurance (COVER) pool reads ---
  const insRead = { address: insurance, abi: INSURANCE_POOL_ABI, chainId: VAULT_CHAIN_ID } as const;
  const { data: insTvl, refetch: refetchInsTvl } = useReadContract({
    ...insRead,
    functionName: "totalAssets",
    query: { enabled: insuranceConfigured },
  });
  const { data: insShares, refetch: refetchInsShares } = useReadContract({
    ...insRead,
    functionName: "balanceOf",
    args: lp ? [lp] : undefined,
    query: { enabled: insuranceConfigured && hasLp },
  });
  const { data: insPosition } = useReadContract({
    ...insRead,
    functionName: "convertToAssets",
    args: [typeof insShares === "bigint" ? insShares : 0n],
    query: { enabled: insuranceConfigured && hasLp && typeof insShares === "bigint" && insShares > 0n },
  });
  const { data: insCooldown } = useReadContract({
    ...insRead,
    functionName: "redeemCooldown",
    query: { enabled: insuranceConfigured },
  });
  const { data: insLastDeposit, refetch: refetchInsLast } = useReadContract({
    ...insRead,
    functionName: "lastDepositAt",
    args: lp ? [lp] : undefined,
    query: { enabled: insuranceConfigured && hasLp },
  });

  const dec = typeof decimalsData === "number" ? decimalsData : 6;
  const sym = typeof symbolData === "string" ? symbolData : "USDC";
  const usd = (v: unknown) => formatUsd(typeof v === "bigint" ? Number(formatUnits(v, dec)) : 0);
  const sharesBig = typeof shares === "bigint" ? shares : 0n;
  const positionBig = typeof positionValue === "bigint" ? positionValue : 0n;
  const pendingBig = typeof pendingShares === "bigint" ? pendingShares : 0n;
  const claimableBig = typeof claimableShares === "bigint" ? claimableShares : 0n;
  const walletBalBig = typeof walletBal === "bigint" ? walletBal : 0n;
  const insSharesBig = typeof insShares === "bigint" ? insShares : 0n;
  const insPositionBig = typeof insPosition === "bigint" ? insPosition : 0n;
  const isOwner = !!vaultOwner && !!lp && String(vaultOwner).toLowerCase() === lp.toLowerCase();

  const [amount, setAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [insAmount, setInsAmount] = useState("");
  const [busy, setBusy] = useState<
    "" | "supply" | "request" | "cancel" | "claim" | "fulfill" | "insSupply" | "insRedeem"
  >("");

  // Insurance cooldown: a withdraw is gated until lastDepositAt + redeemCooldown. Compute remaining
  // seconds in an effect (Date.now is impure at render).
  const [insUnlockIn, setInsUnlockIn] = useState(0);
  useEffect(() => {
    const last = typeof insLastDeposit === "bigint" ? Number(insLastDeposit) : 0;
    const cd = typeof insCooldown === "bigint" ? Number(insCooldown) : 0;
    const tick = () => setInsUnlockIn(Math.max(0, last + cd - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [insLastDeposit, insCooldown]);
  const insLocked = insUnlockIn > 0 && insSharesBig > 0n;

  // Parsed supply input (base units) for the balance gate.
  const parsedSupply = (() => {
    try {
      return parseUnits((amount || "0").replace(/,/g, ""), dec);
    } catch {
      return 0n;
    }
  })();
  const insufficientForSupply = parsedSupply > walletBalBig;

  const parsedInsSupply = (() => {
    try {
      return parseUnits((insAmount || "0").replace(/,/g, ""), dec);
    } catch {
      return 0n;
    }
  })();
  const insufficientForInsSupply = parsedInsSupply > walletBalBig;

  const refetchAll = () => {
    void refetchWallet();
    void refetchTvl();
    void refetchIdle();
    void refetchShares();
    void refetchPending();
    void refetchClaimable();
    void refetchInsTvl();
    void refetchInsShares();
    void refetchInsLast();
  };

  const copyAddr = () => {
    if (!lp) return;
    navigator.clipboard?.writeText(lp);
    notification.success("Smart wallet address copied");
  };

  const supply = async () => {
    if (!vault || !assetAddr || !lp) return;
    if (parsedSupply <= 0n) {
      notification.error("Enter an amount to supply.");
      return;
    }
    if (insufficientForSupply) {
      notification.error(`Smart wallet holds only ${usd(walletBalBig)} ${sym}. Send more USDC to it first.`);
      return;
    }
    setBusy("supply");
    try {
      // Atomic approve + deposit in one sponsored UserOperation (ERC-4626 sync deposit).
      const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, parsedSupply] });
      const depositData = encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [parsedSupply, lp] });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: vault, data: depositData },
      ]);
      notification.success(`Supplied ${amount} ${sym} to the lending vault`);
      setAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  const supplyInsurance = async () => {
    if (!insurance || !assetAddr || !lp) return;
    if (parsedInsSupply <= 0n) {
      notification.error("Enter an amount to supply.");
      return;
    }
    if (insufficientForInsSupply) {
      notification.error(`Smart wallet holds only ${usd(walletBalBig)} ${sym}. Send more USDC to it first.`);
      return;
    }
    setBusy("insSupply");
    try {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [insurance, parsedInsSupply],
      });
      const depositData = encodeFunctionData({
        abi: INSURANCE_POOL_ABI,
        functionName: "deposit",
        args: [parsedInsSupply, lp],
      });
      await sendCalls([
        { to: assetAddr, data: approveData },
        { to: insurance, data: depositData },
      ]);
      notification.success(`Backed the pool with ${insAmount} ${sym} (COVER)`);
      setInsAmount("");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  // Insurance redeem is SYNCHRONOUS (reserves are never lent out) but cooldown-gated.
  const redeemInsurance = async () => {
    if (!insurance || !lp || insSharesBig <= 0n) return;
    if (insLocked) {
      notification.error("COVER is still in its redeem cooldown.");
      return;
    }
    setBusy("insRedeem");
    try {
      await writeContractSponsored({
        address: insurance,
        abi: INSURANCE_POOL_ABI,
        functionName: "redeem",
        args: [insSharesBig, lp, lp],
      });
      notification.success("COVER redeemed — reserves returned to your wallet");
      refetchAll();
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setBusy("");
    }
  };

  // Async redeem: requestRedeem escrows shares; the keeper fulfills as liquidity frees; then claim.
  const requestRedeem = async () => {
    if (!vault || !lp || positionBig <= 0n || sharesBig <= 0n) return;
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
        args: [reqShares, lp, lp],
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
    if (!vault || !lp || pendingBig <= 0n) return;
    setBusy("cancel");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "cancelRedeemRequest",
        args: [pendingBig, lp],
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
    if (!vault || !lp || claimableBig <= 0n) return;
    setBusy("claim");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "redeem",
        args: [claimableBig, lp, lp],
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
    if (!vault || !lp || pendingBig <= 0n) return;
    setBusy("fulfill");
    try {
      await writeContractSponsored({
        address: vault,
        abi: VAULT_ABI,
        functionName: "fulfillRedeem",
        args: [lp, pendingBig],
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
        step={6}
        eyebrow="Liquidity · ERC-4626 + ERC-7540"
        title="Provide liquidity to the lending stack"
        subtitle="LPs supply USDC to the lending vault (ERC-4626) and earn borrower interest; redemptions are asynchronous (ERC-7540): request → the keeper fulfills as liquidity frees → claim. COVER LPs back the pool against defaults and can exit synchronously after a short cooldown. Gas is sponsored."
      />

      {!configured ? (
        <>
          <div className="alert alert-info mb-5">
            <BanknotesIcon className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Lending vault not configured</p>
              <p className="text-sm opacity-80">
                Set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to the deployed vault to enable liquidity provision.
              </p>
            </div>
          </div>
          <Panel eyebrow="Onchain" title="Vault not configured">
            <p className="text-sm text-base-content/70">
              Deploy the vault and set <code>NEXT_PUBLIC_KREDITO_VAULT</code> to enable liquidity provision:
            </p>
            <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2 mt-2">
              yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
            </code>
          </Panel>
        </>
      ) : (
        <div className="space-y-4">
          {/* SMART-WALLET FUNDING — the vault is unseeded; this wallet must HOLD USDC to supply. */}
          <Panel eyebrow="Your smart wallet" title="Fund this address to supply liquidity">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <p className="k-eyebrow mb-1">Smart wallet (LP)</p>
                <div className="flex items-center gap-2">
                  {lp ? (
                    <>
                      <code className="k-mono text-sm break-all">{lp}</code>
                      <button type="button" onClick={copyAddr} className="btn btn-ghost btn-xs gap-1 shrink-0">
                        <DocumentDuplicateIcon className="h-3.5 w-3.5" /> Copy
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-base-content/60">Log in to create your smart wallet.</span>
                  )}
                </div>
              </div>
              <div className="sm:text-right shrink-0">
                <p className="k-eyebrow mb-1">USDC balance</p>
                <p className="k-mono text-2xl font-semibold">
                  {usd(walletBalBig)} {sym}
                </p>
              </div>
            </div>
            <p className="text-xs text-base-content/55 mt-3">
              Send Sepolia {sym} to this address to supply liquidity. Supply is disabled when the amount exceeds this
              balance. Gas for supply/redeem is sponsored.
            </p>
          </Panel>

          {/* Pool stats */}
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
              <p className="k-eyebrow mb-1">Your vault position</p>
              <p className="k-mono text-2xl font-semibold">{usd(positionBig)}</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {/* Supply to the lending vault */}
            <Panel eyebrow="Supply · ERC-4626" title="Supply to the lending vault">
              <label className="block">
                <span className="k-eyebrow">Amount ({sym})</span>
                <div
                  className={`mt-1 flex items-center gap-2 rounded-field border bg-base-100 px-3 transition-colors ${
                    insufficientForSupply
                      ? "border-error focus-within:border-error"
                      : "border-base-300 focus-within:border-primary"
                  }`}
                >
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
                    onClick={() => setAmount(walletBalBig > 0n ? formatUnits(walletBalBig, dec) : "")}
                  >
                    Max {usd(walletBalBig)}
                  </button>
                </div>
              </label>
              {insufficientForSupply && (
                <p className="text-xs text-error mt-1">Exceeds your smart wallet&apos;s {sym} balance.</p>
              )}
              <button
                className="btn btn-primary btn-sm w-full gap-1 mt-3"
                onClick={supply}
                disabled={busy !== "" || !hasLp || parsedSupply <= 0n || insufficientForSupply}
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

            {/* Async redeem from the lending vault */}
            <Panel eyebrow="Redeem · ERC-7540 async" title="Withdraw from the lending vault">
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

          {/* INSURANCE / COVER pool — back the lending vault against defaults */}
          <Panel
            eyebrow="Insurance · COVER · ERC-4626"
            title="Back the pool (insurance)"
            action={
              insuranceConfigured ? (
                <span className="badge badge-ghost gap-1">
                  <ShieldCheckIcon className="h-3.5 w-3.5" /> Reserve TVL {usd(insTvl)}
                </span>
              ) : null
            }
          >
            {!insuranceConfigured ? (
              <p className="text-sm text-base-content/65">
                Set <code>NEXT_PUBLIC_KREDITO_INSURANCE</code> to enable the COVER reserve pool.
              </p>
            ) : (
              <div className="grid lg:grid-cols-2 gap-4 items-start">
                {/* COVER supply */}
                <div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="k-eyebrow mb-0.5">Reserve TVL</p>
                      <p className="k-mono text-lg font-semibold">{usd(insTvl)}</p>
                    </div>
                    <div>
                      <p className="k-eyebrow mb-0.5">Your COVER</p>
                      <p className="k-mono text-lg font-semibold">{usd(insPositionBig)}</p>
                    </div>
                  </div>
                  <label className="block">
                    <span className="k-eyebrow">Amount ({sym})</span>
                    <div
                      className={`mt-1 flex items-center gap-2 rounded-field border bg-base-100 px-3 transition-colors ${
                        insufficientForInsSupply
                          ? "border-error focus-within:border-error"
                          : "border-base-300 focus-within:border-primary"
                      }`}
                    >
                      <input
                        inputMode="decimal"
                        value={insAmount}
                        onChange={e => setInsAmount(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
                      />
                      <button
                        type="button"
                        className="text-xs link shrink-0"
                        onClick={() => setInsAmount(walletBalBig > 0n ? formatUnits(walletBalBig, dec) : "")}
                      >
                        Max {usd(walletBalBig)}
                      </button>
                    </div>
                  </label>
                  {insufficientForInsSupply && (
                    <p className="text-xs text-error mt-1">Exceeds your smart wallet&apos;s {sym} balance.</p>
                  )}
                  <button
                    className="btn btn-primary btn-sm w-full gap-1 mt-3"
                    onClick={supplyInsurance}
                    disabled={busy !== "" || !hasLp || parsedInsSupply <= 0n || insufficientForInsSupply}
                    type="button"
                  >
                    {busy === "insSupply" ? (
                      <>
                        <span className="loading loading-spinner loading-xs" /> Supplying…
                      </>
                    ) : (
                      <>
                        <ShieldCheckIcon className="h-4 w-4" /> Back the pool (sponsored)
                      </>
                    )}
                  </button>
                  <p className="text-xs text-base-content/50 mt-2">
                    COVER LPs earn the streamed protocol fee and absorb default losses first. Batches approve + deposit.
                  </p>
                </div>

                {/* COVER redeem (synchronous, cooldown-gated) */}
                <div>
                  <p className="k-eyebrow mb-1">Redeem COVER</p>
                  {insSharesBig <= 0n ? (
                    <p className="text-sm text-base-content/60">You have no COVER position yet.</p>
                  ) : insLocked ? (
                    <div className="rounded-field bg-warning/10 px-3 py-2">
                      <p className="text-sm font-medium text-warning">Cooldown active</p>
                      <p className="text-xs text-base-content/60 mt-0.5">
                        COVER unlocks in {Math.floor(insUnlockIn / 60)}m {insUnlockIn % 60}s. Reserves can only be
                        pulled after the redeem cooldown since your last deposit.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-field border border-base-300 px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{usd(insPositionBig)}</p>
                        <p className="text-xs text-base-content/55">synchronous · returned to your wallet</p>
                      </div>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={redeemInsurance}
                        disabled={busy !== ""}
                        type="button"
                      >
                        {busy === "insRedeem" ? (
                          <>
                            <span className="loading loading-spinner loading-xs" /> Redeeming…
                          </>
                        ) : (
                          <>Redeem all</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>
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
