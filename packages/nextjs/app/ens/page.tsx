"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import {
  CheckCircleIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { HashChip, PageHeader, Panel, RiskBadge } from "~~/components/kredito";
import { type VerifyResult, verifyPublished } from "~~/kredito/ens";
import { formatDate } from "~~/kredito/format";
import type { RiskTier } from "~~/kredito/types";

// uint riskTier (0 = high, 1 = medium, 2 = low) → UI RiskTier.
const uintToUiRiskTier = (n: number): RiskTier => (n === 2 ? "low" : n === 1 ? "medium" : "high");

const CheckRow = ({ ok, label, hint }: { ok: boolean; label: string; hint: string }) => (
  <div className="flex items-start gap-3 rounded-field border border-base-300 px-3 py-2.5">
    {ok ? (
      <CheckCircleIcon className="h-5 w-5 text-success shrink-0 mt-0.5" />
    ) : (
      <XCircleIcon className="h-5 w-5 text-error shrink-0 mt-0.5" />
    )}
    <div className="min-w-0">
      <p className={`text-sm font-medium ${ok ? "text-base-content" : "text-error"}`}>{label}</p>
      <p className="text-xs text-base-content/55">{hint}</p>
    </div>
  </div>
);

const VerifyView = () => {
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [queried, setQueried] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runVerify = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setQueried(trimmed);
    try {
      const res = await verifyPublished(trimmed);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed. Check the name and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-verify when arriving with ?name=acme.eth (e.g. the "Verify" link after publishing).
  useEffect(() => {
    const fromUrl = searchParams.get("name");
    if (fromUrl) {
      setName(fromUrl);
      void runVerify(fromUrl);
    }
  }, [searchParams, runVerify]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runVerify(name);
  };

  const record = result?.record ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-5 py-8 w-full">
      <PageHeader
        eyebrow="ENS credit identity · Sepolia"
        title="Look up a business, verify its signed score"
        subtitle="Every business publishes its issuer-signed credit attestation to its ENS name. ENS is the identity and discovery layer; the issuer's EIP-712 signature is the trust. Anyone can resolve a name on Sepolia, read the records, and confirm the score is genuine — no account needed."
      />

      <form onSubmit={onSubmit} className="k-card p-4 sm:p-5 mb-6">
        <span className="k-eyebrow">ENS name (Sepolia)</span>
        <div className="mt-1 flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
            <GlobeAltIcon className="h-4 w-4 text-base-content/40 shrink-0" />
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="acme.eth"
              className="w-full bg-transparent py-2.5 outline-none text-sm k-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-primary gap-1.5" disabled={loading || !name.trim()}>
            {loading ? (
              <>
                <span className="loading loading-spinner loading-sm" /> Verifying…
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="h-4 w-4" /> Verify
              </>
            )}
          </button>
        </div>
      </form>

      {loading && (
        <div className="k-card p-10 flex flex-col items-center gap-3 text-center">
          <span className="loading loading-spinner loading-lg text-primary" />
          <p className="text-sm text-base-content/60">
            Resolving <span className="k-mono">{queried}</span> on Sepolia and reading the records…
          </p>
        </div>
      )}

      {!loading && error && (
        <Panel eyebrow="Error" title="Could not verify">
          <p className="text-sm text-error">{error}</p>
        </Panel>
      )}

      {/* No record / no resolver / unregistered — clear empty states. */}
      {!loading && !error && result && !result.ok && !record && (
        <Panel
          eyebrow="Not verified"
          title={
            <span className="inline-flex items-center gap-2">
              <XCircleIcon className="h-5 w-5 text-error" /> No credit attestation found
            </span>
          }
        >
          <p className="text-sm text-base-content/70 mb-3">{result.reason}</p>
          <div className="rounded-field bg-base-200 px-4 py-3 text-sm text-base-content/65">
            <p className="font-medium mb-1">What this means</p>
            <ul className="list-disc list-inside space-y-1">
              <li>The name may not be registered on Sepolia.</li>
              <li>It may have no resolver set.</li>
              <li>
                Or no <code className="k-mono">kredito.attestation</code> record has been published yet.
              </li>
            </ul>
          </div>
          {result.resolvedAddress && (
            <div className="mt-4">
              <p className="k-eyebrow mb-1">Resolves to</p>
              <AddressDisplay address={result.resolvedAddress} />
            </div>
          )}
        </Panel>
      )}

      {/* A record exists — show the verdict and details. */}
      {!loading && !error && result && record && (
        <div className="space-y-5">
          <div
            className={`k-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 ${
              result.ok ? "border-success/40" : "border-error/40"
            }`}
          >
            <div
              className={`grid place-items-center h-14 w-14 rounded-full shrink-0 ${
                result.ok ? "bg-success/15 text-success" : "bg-error/15 text-error"
              }`}
            >
              {result.ok ? <ShieldCheckIcon className="h-8 w-8" /> : <XCircleIcon className="h-8 w-8" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="k-eyebrow">{queried}</p>
              <h2 className={`text-2xl font-semibold ${result.ok ? "text-success" : "text-error"}`}>
                {result.ok ? "Verified credit identity" : "Not verified"}
              </h2>
              <p className="text-sm text-base-content/65 mt-0.5">
                {result.ok
                  ? "The issuer signature is valid, bound to this name, and not expired."
                  : (result.reason ?? "One or more checks failed.")}
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <CheckRow
              ok={result.checks.signatureValid}
              label="Signature valid"
              hint="Recovered signer matches the published issuer"
            />
            <CheckRow
              ok={result.checks.boundToName}
              label="Bound to this name"
              hint="Attestation borrower = resolved address"
            />
            <CheckRow ok={result.checks.notExpired} label="Not expired" hint="Within the attestation validity window" />
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <Panel eyebrow="Result" title="Credit score" className="lg:col-span-1">
              <p className="k-mono text-5xl font-semibold leading-none">{record.score}</p>
              <p className="text-xs text-base-content/55 mt-1">out of 1000</p>
              <div className="mt-4">
                <RiskBadge tier={uintToUiRiskTier(record.riskTier)} />
              </div>
            </Panel>

            <Panel eyebrow="Identity" title="Resolved address" className="lg:col-span-2">
              {result.resolvedAddress ? (
                <AddressDisplay address={result.resolvedAddress} />
              ) : (
                <p className="text-sm text-base-content/55">This name does not resolve to an address.</p>
              )}
              <div className="divide-y divide-base-300 mt-3">
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="text-base-content/60">Issuer (signer)</span>
                  <AddressDisplay address={record.issuer} />
                </div>
                {result.recoveredSigner && (
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span className="text-base-content/60">Recovered signer</span>
                    <AddressDisplay address={result.recoveredSigner} />
                  </div>
                )}
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="text-base-content/60">Issued</span>
                  <span className="k-mono">{formatDate(record.issuedAt)}</span>
                </div>
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="text-base-content/60">Expires</span>
                  <span className={`k-mono ${result.checks.notExpired ? "" : "text-error"}`}>
                    {formatDate(record.expiresAt)}
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          <Panel eyebrow="Proof" title="Signed attestation">
            <div className="space-y-3">
              <div>
                <p className="k-eyebrow mb-1">Borrower</p>
                <HashChip value={record.borrower} lead={10} tail={8} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Evidence digest</p>
                <HashChip value={record.evidenceDigest} lead={10} tail={8} />
              </div>
              <div>
                <p className="k-eyebrow mb-1">Issuer signature (EIP-712)</p>
                <code className="k-mono text-xs break-all block bg-base-200 rounded-field p-2">{record.signature}</code>
              </div>
            </div>
            <p className="text-xs text-base-content/50 mt-3">
              The signature is recovered client-side over the canonical{" "}
              <code className="k-mono">CreditAttestation</code> typed data — exactly as the lending vault verifies it
              onchain.
            </p>
          </Panel>
        </div>
      )}

      {!loading && !error && !result && !queried && (
        <Panel eyebrow="How it works" title="ENS = identity, the signature = trust">
          <ul className="space-y-2 text-sm text-base-content/70 list-disc list-inside">
            <li>Enter any business&apos;s ENS name (e.g. acme.eth) registered on Sepolia.</li>
            <li>Kredito resolves the name and reads its published credit records.</li>
            <li>The issuer&apos;s EIP-712 signature is recovered and checked against the published issuer.</li>
            <li>If it is valid, bound to the name, and unexpired — the score is trustworthy.</li>
          </ul>
        </Panel>
      )}
    </div>
  );
};

export default function EnsVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-5 py-8 w-full flex justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      }
    >
      <VerifyView />
    </Suspense>
  );
}
