"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowTopRightOnSquareIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { HashChip, KreditoIdentityCard } from "~~/components/kredito";
import { type EnsIdentity, fullName } from "~~/lib/kredito";

const blockscoutTxUrl = (hash: string) => `https://eth-sepolia.blockscout.com/tx/${hash}`;

/**
 * Public, no-auth verified-identity card for `<label>.kredito.eth`. Shareable proof-of-credit:
 * anyone can visit /identity/<label> and see the issuer-locked approved credential.
 */
export default function PublicIdentityPage({ params }: { params: Promise<{ label: string }> }) {
  const { label } = use(params);
  const [identity, setIdentity] = useState<EnsIdentity | null>(null);
  const [state, setState] = useState<"loading" | "found" | "notfound">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/identity/${encodeURIComponent(label)}`);
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          setIdentity(json.identity as EnsIdentity);
          setState("found");
        } else {
          setState("notfound");
        }
      } catch {
        if (!cancelled) setState("notfound");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [label]);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (state === "notfound" || !identity) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="k-display text-3xl font-semibold">Identity not found</h1>
        <p className="mt-2 text-base-content/65">
          No credit identity exists for <span className="k-mono">{fullName(label)}</span>.
        </p>
        <Link href="/" className="btn btn-primary btn-sm mt-6">
          Back home
        </Link>
      </div>
    );
  }

  const id = identity;
  const approved = id.status === "approved";

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-5 py-10 w-full space-y-5">
      <KreditoIdentityCard identity={id} />

      {/* Verified credential proof */}
      <div className="k-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="k-eyebrow">Onchain credit credential</p>
          <span className={`badge gap-1 ${approved ? "badge-success" : "badge-ghost"}`}>
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            {approved ? "Verified · Approved" : id.status}
          </span>
        </div>
        <p className="text-sm text-base-content/70">
          This is a publicly-resolvable <span className="k-mono">{fullName(id.label)}</span> credit identity. The credit
          status is issuer-locked onchain — anyone can verify it without trusting a centralized party.
        </p>
        {id.attestation_hash && (
          <div className="mt-4">
            <p className="k-eyebrow mb-1">Attestation hash</p>
            <HashChip value={id.attestation_hash} lead={10} tail={8} />
          </div>
        )}
        {id.tx_hash && (
          <a
            href={blockscoutTxUrl(id.tx_hash)}
            target="_blank"
            rel="noreferrer"
            className="link text-sm inline-flex items-center gap-1 mt-4"
          >
            View mint transaction
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
