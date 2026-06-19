"use client";

import { useEffect, useState } from "react";
import { ArrowUpTrayIcon, CheckCircleIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { RiskTier } from "~~/kredito/types";
import type { UploadedDocument } from "~~/services/lendsignal/types";

// Shared primitives + small pieces used across the extracted Kredito sections
// (onboarding/score/certificate/profile/borrow/liquidity) and the dashboard.

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export const SIGNAL_BADGE: Record<string, string> = {
  positive: "badge-success",
  neutral: "badge-ghost",
  negative: "badge-error",
};
export const BAND_BADGE: Record<string, string> = {
  low: "badge-success",
  medium: "badge-warning",
  high: "badge-error",
};
export const DECISION_BADGE: Record<string, string> = {
  approved: "badge-success",
  manual_review: "badge-warning",
  denied: "badge-error",
};
export const DECISION_LABEL: Record<string, string> = {
  approved: "Approved",
  manual_review: "Manual review",
  denied: "Denied",
};

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const blockscoutAddressUrl = (addr: string) => `https://eth-sepolia.blockscout.com/address/${addr}`;

/**
 * Map the persisted API risk-tier string (`low_default_risk` …) to the shared `RiskTier` union used
 * by the shared `RiskBadge`. Lets the rest of the app render one consistent risk representation.
 */
export const apiTierToRiskTier = (tier: string | null | undefined): RiskTier | null => {
  if (tier === "low_default_risk") return "low";
  if (tier === "medium_default_risk") return "medium";
  if (tier === "high_default_risk") return "high";
  return null;
};

export const Field = ({
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

export const SelectField = ({
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

export const DocSlot = ({
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

/** Compact stat used by Borrow/Liquidity (label + mono value). */
export const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="k-eyebrow mb-1">{label}</p>
    <p className="k-mono text-2xl font-semibold">{value}</p>
  </div>
);

// Live per-document analysis status, driven by the client polling loop.
export type DocStatus = "queued" | "processing" | "completed" | "failed";
export type DocProgress = { filename: string; status: DocStatus };
// "pending" → not started yet; "running" → reduce inference in flight; "done" → finished.
export type ReducePhase = "pending" | "running" | "done";

/**
 * REAL per-document progress for the client-orchestrated map→reduce pipeline. Each document's
 * inference is submitted, then polled individually (queued → processing → completed/failed), so
 * this shows true live state instead of a time-based fake. The reduce step lights up only once
 * every document has completed.
 */
export const AnalyzingProgress = ({ docs, reducePhase }: { docs: DocProgress[]; reducePhase: ReducePhase }) => {
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
    <div className="k-card p-6 max-w-2xl mx-auto" aria-live="polite">
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
