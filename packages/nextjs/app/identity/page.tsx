"use client";

import { useCallback, useEffect, useState } from "react";
import { type Hex } from "viem";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import {
  type EnsIdentity,
  PROFILE_FIELDS,
  type ProfileCol,
  editMessage,
  ensTextRecords,
  isHttpUrl,
  kreditoResolverAbi,
  labelToNode,
  mintMessage,
  normalizeLabel,
  profileDigest,
  sanitizeProfile,
  socialUrl,
} from "~~/lib/kredito";

type Lookup = { decisionStatus?: string; hasIdentity?: boolean; identity?: EnsIdentity | null };

const STATUS_BADGE: Record<string, string> = {
  approved: "badge-success",
  denied: "badge-error",
  pending: "badge-warning",
  review: "badge-info",
  defaulted: "badge-error",
  none: "badge-ghost",
};

const SOCIAL_COLS: ProfileCol[] = ["twitter", "github", "telegram", "linkedin", "discord", "email"];

function IdentityCard({ id }: { id: EnsIdentity }) {
  const banner = isHttpUrl(id.header_url) ? id.header_url : null;
  const avatar = isHttpUrl(id.avatar_url) ? id.avatar_url : null;
  const website = isHttpUrl(id.url) ? id.url : null;
  return (
    <div className="card bg-base-100 shadow-xl overflow-hidden max-w-md">
      <div
        className="h-28 bg-base-300"
        style={
          banner
            ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      />
      <div className="card-body pt-0">
        <div className="-mt-12 mb-1">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="w-20 h-20 rounded-full object-cover ring-4 ring-base-100 bg-base-100" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-base-200 ring-4 ring-base-100" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <h2 className="card-title">{id.display_name || id.full_name}</h2>
          <span className={`badge ${STATUS_BADGE[id.status] ?? "badge-ghost"}`}>{id.status}</span>
        </div>
        <p className="font-mono text-sm opacity-70">{id.full_name}</p>
        {id.description && <p className="text-sm mt-1">{id.description}</p>}
        {id.location && <p className="text-xs opacity-60 mt-1">📍 {id.location}</p>}
        {website && (
          <a className="link link-primary text-sm break-all" href={website} target="_blank" rel="noreferrer">
            {website}
          </a>
        )}
        <div className="flex flex-wrap gap-3 mt-2 text-sm">
          {SOCIAL_COLS.map(col => {
            const value = id[col];
            if (!value) return null;
            const href = socialUrl(col, value);
            const label = PROFILE_FIELDS.find(f => f.col === col)?.label ?? col;
            return href ? (
              <a key={col} className="link link-primary" href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            ) : (
              <span key={col} className="opacity-70">
                {label}: {value}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProfileEditor({
  id,
  onSave,
  busy,
}: {
  id: EnsIdentity;
  onSave: (f: Record<ProfileCol, string>) => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<Record<ProfileCol, string>>(
    () =>
      Object.fromEntries(PROFILE_FIELDS.map(f => [f.col, (id[f.col] as string) ?? ""])) as Record<ProfileCol, string>,
  );
  const set = (col: ProfileCol, v: string) => setForm(p => ({ ...p, [col]: v }));
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Edit profile</h3>
        {PROFILE_FIELDS.map(f => (
          <label key={f.col} className="form-control">
            <span className="label-text text-xs opacity-70">{f.label}</span>
            {f.col === "description" ? (
              <textarea
                className="textarea textarea-bordered"
                placeholder={f.placeholder}
                value={form[f.col]}
                onChange={e => set(f.col, e.target.value)}
              />
            ) : (
              <input
                className="input input-bordered"
                placeholder={f.placeholder}
                value={form[f.col]}
                onChange={e => set(f.col, e.target.value)}
              />
            )}
          </label>
        ))}
        <button className="btn btn-primary" disabled={busy} onClick={() => onSave(form)}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

export default function IdentityPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [label, setLabel] = useState("");
  const [avail, setAvail] = useState<{ available?: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return setLookup(null);
    const r = await fetch(`/api/identity/lookup?wallet=${address}`);
    setLookup(await r.json());
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    setBusy(true);
    setError(null);
    try {
      const nlabel = normalizeLabel(label);
      const signature = await signMessageAsync({ message: mintMessage(address, nlabel) });
      const r = await fetch("/api/identity/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, label: nlabel, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Mint failed");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (form: Record<ProfileCol, string>) => {
    if (!address || !lookup?.identity) return;
    const id = lookup.identity;
    setBusy(true);
    setError(null);
    try {
      const clean = sanitizeProfile(form);
      // Canonical write: on-chain resolver.setTexts (owner-gated, sponsored) — when configured.
      const resolver = process.env.NEXT_PUBLIC_KREDITO_RESOLVER as Hex | undefined;
      if (resolver) {
        const { keys, values } = ensTextRecords(clean);
        if (keys.length) {
          await writeContractAsync({
            address: resolver,
            abi: kreditoResolverAbi,
            functionName: "setTexts",
            args: [labelToNode(id.label), keys, values],
          });
        }
      }
      // Mirror to Supabase for fast card rendering (owner-authenticated, content-bound + TTL'd).
      const issuedAt = Date.now();
      const signature = await signMessageAsync({
        message: editMessage(address, id.label, profileDigest(clean), issuedAt),
      });
      const r = await fetch(`/api/identity/${id.label}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, profile: form, issuedAt, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      setEditing(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Credit identity</h1>
        <p className="opacity-70 text-sm">
          Claim and manage your <span className="font-mono">.kredito.eth</span> profile. Only approved businesses can
          mint.
        </p>
      </div>

      {!address && <div className="alert">Connect your wallet to continue.</div>}
      {error && <div className="alert alert-error text-sm">{error}</div>}

      {address && lookup?.hasIdentity && lookup.identity && (
        <div className="space-y-4">
          <IdentityCard id={lookup.identity} />
          <button className="btn btn-sm" onClick={() => setEditing(e => !e)}>
            {editing ? "Close editor" : "Edit profile"}
          </button>
          {editing && <ProfileEditor id={lookup.identity} onSave={saveProfile} busy={busy} />}
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
              <span className="label-text">Choose your name</span>
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
              {avail?.available === true && <span className="text-success text-xs mt-1">available</span>}
              {avail?.available === false && !avail.error && <span className="text-error text-xs mt-1">taken</span>}
            </label>
            <button className="btn btn-primary" disabled={busy || !label || avail?.available !== true} onClick={mint}>
              {busy ? "Minting…" : `Mint ${label || "name"}.kredito.eth`}
            </button>
            <p className="text-xs opacity-60">You can fill in your full profile after minting.</p>
          </div>
        </div>
      )}
    </div>
  );
}
