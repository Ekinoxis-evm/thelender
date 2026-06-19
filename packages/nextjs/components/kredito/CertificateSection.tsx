"use client";

import { useEffect, useState } from "react";
import { Address as AddressDisplay } from "@scaffold-ui/components";
import { recoverTypedDataAddress } from "viem";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { CertificateCard, HashChip, PageHeader, Panel, RiskBadge } from "~~/components/kredito";
import { useSmartWalletSign } from "~~/hooks/scaffold-eth/useSmartWallet";
import { typedData } from "~~/kredito/attestation";
import { type StoredScore, toCertificate } from "~~/kredito/scoreStore";
import { KREDITO_VAULT_ADDRESS, type SignedAttestation, sepoliaTxUrl } from "~~/kredito/vault";
import { creditLimitUsd, fullName, mintMessage, normalizeLabel } from "~~/lib/kredito";
import { notification } from "~~/utils/scaffold-eth";

// Best-effort seed for the subname label from a typed ENS name (strip the TLD); "" on any failure
// so an un-normalizable input never throws during render.
export const safeLabel = (ensName: string): string => {
  const raw = (ensName || "").trim().split(".")[0] ?? "";
  try {
    return raw ? normalizeLabel(raw) : "";
  } catch {
    return "";
  }
};

export const CertificateSection = ({
  result,
  borrower,
  legalName,
  att,
  setAtt,
  onMinted,
  onBack,
  onNext,
  // When the wallet ALREADY owns a minted identity (the dashboard "re-sign to borrow" route),
  // hide the mint panel and let the next CTA fire as soon as the attestation is signed.
  alreadyMinted = false,
  nextLabel,
}: {
  result: StoredScore;
  borrower: `0x${string}`;
  legalName: string;
  att: SignedAttestation | null;
  setAtt: (a: SignedAttestation | null) => void;
  onMinted: (label: string) => void;
  onBack: () => void;
  onNext: () => void;
  alreadyMinted?: boolean;
  nextLabel?: string;
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

  const nextReady = alreadyMinted ? !!att : !!minted;
  const nextCta = nextLabel ?? (alreadyMinted ? "Continue to borrow" : "Continue to profile setup");

  return (
    <>
      <PageHeader
        step={3}
        eyebrow="Credit identity"
        title={alreadyMinted ? "Sign your attestation to borrow" : "Sign your attestation, mint your identity"}
        subtitle={
          alreadyMinted
            ? "Your kredito.eth identity is already minted. Re-sign a fresh EIP-712 attestation over your score — the vault verifies it onchain to gate the loan."
            : "The protocol issuer signs an EIP-712 attestation over your score (the vault verifies it onchain to gate the loan). Then mint your own .kredito.eth subname as the credit certificate — the issuer writes a locked approved status, and you own the name."
        }
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
                      <CheckCircleIcon className="h-5 w-5" aria-hidden="true" /> Verified — recovered signer = issuer
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
                {alreadyMinted && (
                  <button className="btn btn-primary btn-sm w-full gap-1" onClick={onNext} type="button">
                    {nextCta} <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
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
                      <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" /> Sign credit attestation
                    </>
                  )}
                </button>
              </>
            )}
          </Panel>

          {/* Mint the *.kredito.eth credit identity (ENSv2 subname) — the onchain certificate. */}
          {!alreadyMinted && (
            <Panel eyebrow="ENS credit identity · Sepolia" title="Mint your kredito.eth identity">
              {!att ? (
                <p className="text-sm text-base-content/55">
                  Sign the attestation above first, then mint your identity.
                </p>
              ) : minted ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-success">
                    <CheckCircleIcon className="h-5 w-5" aria-hidden="true" /> Minted{" "}
                    <span className="k-mono">{fullName(minted.label)}</span>
                  </div>
                  <p className="text-sm text-base-content/65">
                    Your onchain credit identity is live. The issuer-locked <code>kredito.status</code> record reads{" "}
                    <span className="k-mono">approved</span> — you own the name and can edit your profile records, but
                    not the status.
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
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                  <button className="btn btn-primary btn-sm w-full gap-1" onClick={onNext} type="button">
                    Continue to profile setup <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-base-content/65">
                    Mint a <span className="k-mono">{fullName("yourname")}</span> subname as your credit certificate.
                    The approved status + attestation hash are written by the issuer and locked onchain; you own the
                    name.
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
                        <GlobeAltIcon className="h-4 w-4" aria-hidden="true" /> Mint{" "}
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
          )}
        </div>
      </div>
      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <button className="btn btn-primary gap-1" onClick={onNext} type="button" disabled={!nextReady}>
          {nextReady ? nextCta : alreadyMinted ? "Sign your attestation to continue" : "Mint your identity to continue"}{" "}
          <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </>
  );
};
