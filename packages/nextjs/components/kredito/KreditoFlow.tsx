"use client";

import { useState } from "react";
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
import { CertificateCard, HashChip, PageHeader, Panel, RiskBadge, ScoreMeter, SignalRow } from "~~/components/kredito";
import { formatUsd } from "~~/kredito/format";
import { DEMO_BORROWERS, DEMO_PROFILE, DEMO_VAULT } from "~~/kredito/mock";
import { type StoredScore, saveScoreResult, toCertificate, toUiRiskTier } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import type { UploadedDocument } from "~~/services/lendsignal/types";
import { notification } from "~~/utils/scaffold-eth";

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

// ---------------------------------------------------------------- the flow

export const KreditoFlow = () => {
  const { address, isSmartWallet } = useKreditoWallet();

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  const [profile, setProfile] = useState(DEMO_PROFILE);
  const [archetype, setArchetype] = useState<string>("strong");
  const [docs, setDocs] = useState<Record<string, UploadedDocument | null>>({});
  const [submitting, setSubmitting] = useState(false);
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

  const runCreditCheck = async () => {
    setSubmitting(true);
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
      const body =
        uploadedDocs.length > 0 ? { ...base, documents: uploadedDocs } : { ...base, demoProfileId: archetype };

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
          <div className="grid lg:grid-cols-3 gap-5">
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
        </>
      )}

      {/* STEP 2 — SCORE */}
      {step === 1 && result && <ScoreSection result={result} onBack={() => setStep(0)} onIssue={() => advance(2)} />}

      {/* STEP 3 — CERTIFICATE */}
      {step === 2 && result && (
        <CertificateSection
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
          <Panel eyebrow="Evidence anchors" title="Onchain hashes">
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

const CertificateSection = ({
  result,
  borrower,
  onBack,
  onNext,
}: {
  result: StoredScore;
  borrower: `0x${string}`;
  onBack: () => void;
  onNext: () => void;
}) => {
  const cert = toCertificate(result, borrower);
  const [issuing, setIssuing] = useState(false);
  const [tx, setTx] = useState<{ txHash: string; explorer: string; action: string } | null>(null);

  const issueOnchain = async () => {
    setIssuing(true);
    try {
      const res = await fetch("/api/lendsignal/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrower, scoreInputs: result.scoreInputs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Issuance failed");
      setTx(json);
      notification.success(`Certificate ${json.action === "update" ? "updated" : "issued"} onchain`);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Issuance failed");
    } finally {
      setIssuing(false);
    }
  };

  return (
    <>
      <PageHeader
        step={3}
        eyebrow="Credit certificate"
        title="A soulbound credit identity"
        subtitle="The protocol issuer mints the blended score as an updateable, soulbound Credit Certificate — only scores, risk tier and content hashes go onchain."
      />
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="flex justify-center">
          <CertificateCard cert={cert} />
        </div>
        <div className="space-y-4">
          <Panel eyebrow="Summary" title="What gets published">
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
                <span className="k-mono">{tx ? "ISSUED" : cert.status}</span>
              </li>
            </ul>
          </Panel>

          <Panel eyebrow="Onchain" title="Issue certificate">
            {tx ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-success text-sm font-medium">
                  <CheckCircleIcon className="h-5 w-5 shrink-0" />
                  Certificate {tx.action === "update" ? "updated" : "issued"} onchain
                </div>
                <div>
                  <p className="k-eyebrow mb-1">Transaction</p>
                  <a
                    href={tx.explorer}
                    target="_blank"
                    rel="noreferrer"
                    className="link k-mono text-xs break-all inline-flex items-center gap-1"
                  >
                    {tx.txHash}
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-base-content/65 mb-3">
                  The protocol issuer signs <code>issueCertificate</code> with the real attested score and hashes,
                  minting the soulbound certificate to your wallet. (ENS gating comes later.)
                </p>
                <button className="btn btn-primary btn-sm w-full gap-1" onClick={issueOnchain} disabled={issuing}>
                  {issuing ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Issuing onchain…
                    </>
                  ) : (
                    <>
                      <ShieldCheckIcon className="h-4 w-4" /> Issue certificate onchain
                    </>
                  )}
                </button>
              </>
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
        title="Borrow against your certificate"
        subtitle="The vault reads the certificate and pays out an undercollateralized loan. (Lending layer — demo.)"
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
          <p className="text-sm text-error">Certificate not eligible — improve the score before borrowing.</p>
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
