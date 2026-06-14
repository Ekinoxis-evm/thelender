"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { type EnsIdentity, isHttpUrl, isTwitterHandle, mintMessage, normalizeLabel } from "~~/lib/kredito";

type Lookup = {
  decisionStatus?: string;
  hasIdentity?: boolean;
  identity?: EnsIdentity | null;
  labelAvailable?: boolean;
  labelError?: string;
};

const STATUS_BADGE: Record<string, string> = {
  approved: "badge-success",
  denied: "badge-error",
  pending: "badge-warning",
  review: "badge-info",
  defaulted: "badge-error",
  none: "badge-ghost",
};

function IdentityCard({ id }: { id: EnsIdentity }) {
  // Allowlist schemes before rendering — never trust stored profile values as hrefs/src.
  const safeAvatar = isHttpUrl(id.avatar_url) ? id.avatar_url : null;
  const safeUrl = isHttpUrl(id.url) ? id.url : null;
  const safeTwitter = isTwitterHandle(id.twitter) ? id.twitter : null;
  return (
    <div className="card bg-base-100 shadow-xl max-w-sm">
      <div className="card-body items-center text-center">
        {safeAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={safeAvatar} alt="" className="w-20 h-20 rounded-full object-cover" />
        ) : (
          <div className="w-20 h-20 rounded-full bg-base-300" />
        )}
        <h2 className="card-title mt-2">{id.display_name || id.full_name}</h2>
        <p className="font-mono text-sm opacity-70">{id.full_name}</p>
        <span className={`badge ${STATUS_BADGE[id.status] ?? "badge-ghost"} mt-1`}>{id.status}</span>
        <div className="flex gap-3 mt-3 text-sm">
          {safeUrl && (
            <a className="link link-primary" href={safeUrl} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
          {safeTwitter && (
            <a className="link link-primary" href={`https://x.com/${safeTwitter}`} target="_blank" rel="noreferrer">
              @{safeTwitter}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IdentityPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [label, setLabel] = useState("");
  const [avail, setAvail] = useState<{ available?: boolean; error?: string } | null>(null);
  const [profile, setProfile] = useState({ display_name: "", url: "", twitter: "", avatar_url: "" });
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return setLookup(null);
    const r = await fetch(`/api/identity/lookup?wallet=${address}`);
    setLookup(await r.json());
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // debounced label availability
  useEffect(() => {
    if (!label) return setAvail(null);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/identity/lookup?label=${encodeURIComponent(label)}`);
      const j = await r.json();
      setAvail({ available: j.labelAvailable, error: j.labelError });
    }, 350);
    return () => clearTimeout(t);
  }, [label]);

  const mint = async () => {
    if (!address) return;
    setMinting(true);
    setError(null);
    try {
      const nlabel = normalizeLabel(label); // same normalized value the server verifies + mints
      const signature = await signMessageAsync({ message: mintMessage(address, nlabel) });
      const r = await fetch("/api/identity/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, label: nlabel, profile, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Mint failed");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Credit identity</h1>
        <p className="opacity-70 text-sm">
          Claim your <span className="font-mono">.kredito.eth</span> name. Only approved businesses can mint.
        </p>
      </div>

      {!address && <div className="alert">Connect your wallet to continue.</div>}

      {address && lookup?.hasIdentity && lookup.identity && (
        <div className="space-y-3">
          <p className="text-sm opacity-70">Your credit identity:</p>
          <IdentityCard id={lookup.identity} />
        </div>
      )}

      {address && lookup && !lookup.hasIdentity && lookup.decisionStatus !== "approved" && (
        <div className="alert alert-warning">
          <span>
            This wallet is not approved yet (status:{" "}
            <span className={`badge ${STATUS_BADGE[lookup.decisionStatus ?? "none"]}`}>{lookup.decisionStatus}</span>).
            Complete onboarding and the credit review first.
          </span>
        </div>
      )}

      {address && lookup && !lookup.hasIdentity && lookup.decisionStatus === "approved" && (
        <div className="card bg-base-100 shadow">
          <div className="card-body space-y-4">
            <span className="badge badge-success">approved</span>

            <label className="form-control">
              <span className="label-text">Name</span>
              <div className="join">
                <input
                  className="input input-bordered join-item w-full"
                  placeholder="acme"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                />
                <span className="btn btn-disabled join-item font-mono">.kredito.eth</span>
              </div>
              {avail?.error && <span className="text-error text-xs mt-1">{avail.error}</span>}
              {avail && avail.available === true && <span className="text-success text-xs mt-1">available</span>}
              {avail && avail.available === false && !avail.error && (
                <span className="text-error text-xs mt-1">taken</span>
              )}
            </label>

            <input
              className="input input-bordered"
              placeholder="Display name"
              value={profile.display_name}
              onChange={e => setProfile(p => ({ ...p, display_name: e.target.value }))}
            />
            <input
              className="input input-bordered"
              placeholder="Website (https://…)"
              value={profile.url}
              onChange={e => setProfile(p => ({ ...p, url: e.target.value }))}
            />
            <input
              className="input input-bordered"
              placeholder="X handle (without @)"
              value={profile.twitter}
              onChange={e => setProfile(p => ({ ...p, twitter: e.target.value }))}
            />
            <input
              className="input input-bordered"
              placeholder="Avatar image URL"
              value={profile.avatar_url}
              onChange={e => setProfile(p => ({ ...p, avatar_url: e.target.value }))}
            />

            {error && <div className="alert alert-error text-sm">{error}</div>}

            <button
              className="btn btn-primary"
              disabled={minting || !label || avail?.available !== true}
              onClick={mint}
            >
              {minting ? "Minting…" : `Mint ${label || "name"}.kredito.eth`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
