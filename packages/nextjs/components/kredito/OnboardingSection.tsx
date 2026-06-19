"use client";

import { useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { IdentityChip, PageHeader, Panel } from "~~/components/kredito";
import { RecentChecks } from "~~/components/kredito/RecentChecks";
import {
  AnalyzingProgress,
  type DocProgress,
  DocSlot,
  type DocStatus,
  Field,
  type ReducePhase,
  SelectField,
  fileToBase64,
} from "~~/components/kredito/flowBits";
import { useKreditoIdentity } from "~~/hooks/scaffold-eth/useKreditoIdentity";
import { type StoredScore, saveScoreResult } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import { COUNTRIES, ENTERPRISE_TYPES } from "~~/lib/countries";
import type { UploadedDocument } from "~~/services/lendsignal/types";
import { notification } from "~~/utils/scaffold-eth";

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

// The onboarding form starts empty — the user enters their own business identity details.
export type FormProfile = {
  legalName: string;
  country: string;
  enterpriseType: string;
  taxNumber: string;
  registryNumber: string;
};

export const EMPTY_PROFILE: FormProfile = {
  legalName: "",
  country: "",
  enterpriseType: "",
  taxNumber: "",
  registryNumber: "",
};

export const OnboardingSection = ({
  profile,
  setProfile,
  onScored,
}: {
  profile: FormProfile;
  setProfile: (updater: (p: FormProfile) => FormProfile) => void;
  onScored: (result: StoredScore) => void;
}) => {
  const { address, isSmartWallet } = useKreditoWallet();
  const { identity: walletIdentity } = useKreditoIdentity(address ?? undefined);

  const [docs, setDocs] = useState<Record<string, UploadedDocument | null>>({});
  const [submitting, setSubmitting] = useState(false);
  // REAL per-document analysis state + the reduce phase, driving AnalyzingProgress live.
  const [docProgress, setDocProgress] = useState<DocProgress[]>([]);
  const [reducePhase, setReducePhase] = useState<ReducePhase>("pending");

  const set = (k: keyof FormProfile) => (v: string) => setProfile(p => ({ ...p, [k]: v }));
  const uploadedDocs = Object.values(docs).filter(Boolean) as UploadedDocument[];

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
      saveScoreResult(finishJson);
      notification.success("Confidential credit check complete");
      onScored(finishJson as StoredScore);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Scoring failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        step={1}
        eyebrow="Business onboarding"
        title="Become a credit identity"
        subtitle="Submit your business profile and upload each piece of evidence. The connected wallet becomes the onchain identifier used by the certificate and the lending vault."
      />
      {submitting && <AnalyzingProgress docs={docProgress} reducePhase={reducePhase} />}
      <div className={submitting ? "hidden" : "grid lg:grid-cols-3 gap-5 items-start"}>
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
            title="Upload documents (at least one)"
            action={
              <span className="k-mono text-xs text-base-content/55 tabular-nums">
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

          {/* Primary action — prominent, full-width, the clear next step. */}
          <div className="k-card p-5 sm:p-6">
            <button className="btn btn-primary btn-lg w-full gap-2" onClick={runCreditCheck} disabled={submitting}>
              {submitting ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Running confidential inference…
                </>
              ) : (
                <>
                  Run confidential credit check
                  <ArrowRightIcon className="h-5 w-5" aria-hidden="true" />
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-base-content/50">
              Attested privately in the Chainlink TEE · usually 2–4 minutes
            </p>
          </div>
        </div>

        {/* Secondary context — the connected wallet that becomes the credit identifier. */}
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
        </div>
      </div>
      {!submitting && <RecentChecks borrower={address} />}
    </>
  );
};
