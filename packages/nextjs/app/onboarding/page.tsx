"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import { ArrowRightIcon, ArrowUpTrayIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { FlowShell, PageHeader, Panel } from "~~/components/kredito";
import { DEMO_BORROWERS, DEMO_PROFILE } from "~~/kredito/mock";
import { saveScoreResult } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import type { UploadedDocument } from "~~/services/lendsignal/types";
import { notification } from "~~/utils/scaffold-eth";

const DOCS = [
  "Business registration",
  "Tax identifier",
  "Bank statements (3mo)",
  "Financial statements",
  "Accounts receivable aging",
];

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

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

export default function OnboardingPage() {
  const router = useRouter();
  const { address, isSmartWallet } = useKreditoWallet();
  const [profile, setProfile] = useState(DEMO_PROFILE);
  const [archetype, setArchetype] = useState<string>("strong");
  const [uploads, setUploads] = useState<UploadedDocument[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof profile) => (v: string) => setProfile(p => ({ ...p, [k]: v }));

  const onFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList);
    if (uploads.length + incoming.length > MAX_FILES) {
      notification.error(`At most ${MAX_FILES} documents.`);
      return;
    }
    try {
      const docs: UploadedDocument[] = [];
      for (const file of incoming) {
        if (file.size > MAX_BYTES) {
          notification.error(`${file.name} exceeds 10 MiB.`);
          continue;
        }
        docs.push({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64: await fileToBase64(file),
        });
      }
      if (docs.length) setUploads(prev => [...prev, ...docs]);
    } catch {
      notification.error("Could not read one of the files.");
    }
  };

  const removeUpload = (name: string) => setUploads(prev => prev.filter(d => d.filename !== name));

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
      // Uploaded documents take the real path; otherwise use the selected demo archetype
      // (server attaches representative docs and runs the same attested inference).
      const body =
        uploads.length > 0
          ? { profile: apiProfile, documents: uploads }
          : { profile: apiProfile, demoProfileId: archetype };

      const res = await fetch("/api/lendsignal/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Scoring failed");

      saveScoreResult(json);
      notification.success("Confidential credit check complete");
      router.push("/score");
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Scoring failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FlowShell activeKey="onboarding">
      <PageHeader
        step={1}
        eyebrow="Business onboarding"
        title="Become a credit identity"
        subtitle="Submit your business profile and evidence. The connected wallet becomes the onchain identifier used by the certificate, the ENS gate and the lending vault."
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4">
          <Panel eyebrow="Business profile" title="Company information" className="sm:col-span-2">
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

          <Panel eyebrow="Evidence" title="Documents & KYC/KYB" className="sm:col-span-2">
            <ul className="grid sm:grid-cols-2 gap-2.5">
              {DOCS.map(d => (
                <li key={d} className="flex items-center gap-2 text-sm">
                  <CheckCircleIcon className="h-5 w-5 text-success shrink-0" />
                  <span>{d}</span>
                  <span className="k-mono text-[11px] text-base-content/40 ml-auto">required</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="btn btn-outline btn-sm gap-2 cursor-pointer">
                <ArrowUpTrayIcon className="h-4 w-4" />
                Upload documents
                <input type="file" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
              </label>
              <span className="text-xs text-base-content/55">
                {uploads.length > 0
                  ? `${uploads.length} file(s) → sent to the Confidential AI TEE`
                  : "No files? The selected demo borrower attaches representative docs."}
              </span>
            </div>

            {uploads.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {uploads.map(doc => (
                  <span key={doc.filename} className="badge badge-outline gap-1 py-3">
                    {doc.filename}
                    <button type="button" onClick={() => removeUpload(doc.filename)}>
                      <XMarkIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <p className="mt-4 text-xs text-base-content/55">
              Raw documents stay inside the Chainlink enclave and never go onchain. Only normalized scores and content
              hashes are published — the privacy boundary enforced by the registry.
            </p>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel eyebrow="Demo" title="Borrower profile">
            <div className="space-y-2">
              {DEMO_BORROWERS.map(b => (
                <button
                  key={b.key}
                  onClick={() => setArchetype(b.key)}
                  disabled={uploads.length > 0}
                  className={`w-full text-left rounded-field border px-3 py-2.5 transition-colors disabled:opacity-40 ${
                    archetype === b.key && uploads.length === 0
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
                <Address address={address} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-base-300" />
                Connect a wallet (top right) to set your credit identity
              </div>
            )}
            <p className="mt-2 text-xs text-base-content/55">
              This wallet will hold the soulbound Credit Certificate and be the subject of the ENS gate.
            </p>
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
          <p className="text-center text-xs text-base-content/45 -mt-2">
            Attested inference in the Chainlink TEE · ~10–40s
          </p>
        </div>
      </div>
    </FlowShell>
  );
}
