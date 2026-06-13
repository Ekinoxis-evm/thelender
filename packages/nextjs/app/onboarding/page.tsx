"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { FlowShell, PageHeader, Panel } from "~~/components/lendsignal";
import { DEMO_BORROWERS, DEMO_PROFILE } from "~~/lendsignal/mock";

const DOCS = [
  "Business registration",
  "Tax identifier",
  "Bank statements (3mo)",
  "Financial statements",
  "Accounts receivable aging",
];

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
    <span className="ls-eyebrow">{label}</span>
    <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-transparent py-2.5 outline-none text-sm"
      />
      {suffix && <span className="ls-mono text-xs text-base-content/45">{suffix}</span>}
    </div>
  </label>
);

export default function OnboardingPage() {
  const { isConnected } = useAccount();
  const [profile, setProfile] = useState(DEMO_PROFILE);
  const [archetype, setArchetype] = useState<string>("strong");

  const set = (k: keyof typeof profile) => (v: string) => setProfile(p => ({ ...p, [k]: v }));

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
                  <span className="ls-mono text-[11px] text-base-content/40 ml-auto">processed</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-base-content/55">
              Raw documents stay offchain. Only normalized scores and content hashes are published — the privacy
              boundary enforced by the registry.
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
                  className={`w-full text-left rounded-field border px-3 py-2.5 transition-colors ${
                    archetype === b.key ? "border-primary bg-primary/5" : "border-base-300 hover:bg-base-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{b.label}</span>
                    <span className="ls-mono text-xs text-base-content/50">
                      {b.ai}/{b.bureau}
                    </span>
                  </div>
                  <p className="text-xs text-base-content/55 mt-0.5">{b.blurb}</p>
                </button>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Wallet" title="Credit identity">
            <div className="flex items-center gap-2 text-sm">
              <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-success" : "bg-base-300"}`} />
              {isConnected ? "Wallet connected" : "Connect a wallet (top right)"}
            </div>
            <p className="mt-2 text-xs text-base-content/55">
              This wallet will hold the soulbound Credit Certificate and be the subject of the ENS gate.
            </p>
          </Panel>
        </div>
      </div>
    </FlowShell>
  );
}
