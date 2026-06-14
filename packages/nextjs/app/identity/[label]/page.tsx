"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowTopRightOnSquareIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { HashChip } from "~~/components/kredito";
import { type EnsIdentity, PROFILE_FIELDS, type ProfileCol, fullName, isHttpUrl, socialUrl } from "~~/lib/kredito";

const SOCIAL_COLS: ProfileCol[] = ["twitter", "github", "telegram", "linkedin", "discord", "email"];

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
  const banner = isHttpUrl(id.header_url) ? id.header_url : null;
  const avatar = isHttpUrl(id.avatar_url) ? id.avatar_url : null;
  const website = isHttpUrl(id.url) ? id.url : null;
  const approved = id.status === "approved";

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-5 py-10 w-full space-y-5">
      <div className="k-card overflow-hidden">
        {/* Banner */}
        <div
          className="h-32 bg-base-300"
          style={
            banner
              ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
        <div className="px-5 sm:px-6 pb-6">
          {/* Avatar */}
          <div className="-mt-12 mb-2">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                className="w-24 h-24 rounded-full object-cover ring-4 ring-base-100 bg-base-100"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-base-200 ring-4 ring-base-100" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="k-display text-2xl font-semibold">
              {id.display_name || id.full_name || fullName(id.label)}
            </h1>
            <span className={`badge gap-1 ${approved ? "badge-success" : "badge-ghost"}`}>
              <ShieldCheckIcon className="h-3.5 w-3.5" />
              {approved ? "Verified · Approved" : id.status}
            </span>
          </div>
          <p className="k-mono text-sm text-base-content/55 mt-0.5">{id.full_name || fullName(id.label)}</p>

          {id.description && <p className="mt-3 text-sm text-base-content/80 leading-relaxed">{id.description}</p>}

          {(website || id.location) && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {id.location && <span className="text-base-content/60">📍 {id.location}</span>}
              {website && (
                <a className="link link-primary break-all" href={website} target="_blank" rel="noreferrer">
                  {website}
                </a>
              )}
            </div>
          )}

          {/* Socials */}
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {SOCIAL_COLS.map(col => {
              const value = id[col];
              if (!value) return null;
              const href = socialUrl(col, value);
              const fieldLabel = PROFILE_FIELDS.find(f => f.col === col)?.label ?? col;
              return href ? (
                <a key={col} className="link link-primary" href={href} target="_blank" rel="noreferrer">
                  {fieldLabel}
                </a>
              ) : (
                <span key={col} className="text-base-content/70">
                  {fieldLabel}: {value}
                </span>
              );
            })}
          </div>
        </div>
      </div>

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
