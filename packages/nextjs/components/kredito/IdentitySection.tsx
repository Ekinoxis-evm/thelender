"use client";

import { useCallback, useEffect, useState } from "react";
import { type Hex } from "viem";
import { useSignMessage, useWriteContract } from "wagmi";
import { ArrowLeftIcon, ArrowRightIcon, GlobeAltIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "~~/components/kredito/PageHeader";
import { Panel } from "~~/components/kredito/Panel";
import type { StoredScore } from "~~/kredito/scoreStore";
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
import { notification } from "~~/utils/scaffold-eth";

const STATUS_BADGE: Record<string, string> = {
  approved: "badge-success",
  denied: "badge-error",
  pending: "badge-warning",
  review: "badge-info",
  defaulted: "badge-error",
};

const SOCIAL_COLS: ProfileCol[] = ["twitter", "github", "telegram", "linkedin", "discord", "email"];

/** The branded credit-identity card (banner + avatar + status + profile). */
const IdentityCard = ({ id }: { id: EnsIdentity }) => {
  const banner = isHttpUrl(id.header_url) ? id.header_url : null;
  const avatar = isHttpUrl(id.avatar_url) ? id.avatar_url : null;
  const website = isHttpUrl(id.url) ? id.url : null;
  return (
    <div className="k-card overflow-hidden">
      <div
        className="h-28 k-hero"
        style={
          banner
            ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      />
      <div className="px-5 pb-5">
        <div className="-mt-12 mb-1">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover ring-4 ring-base-100 bg-base-100" />
          ) : (
            <div className="h-20 w-20 rounded-full k-hero grid place-items-center ring-4 ring-base-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/kredito-icon.svg" alt="" className="h-9 w-9" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold leading-tight truncate">{id.display_name || id.full_name}</h2>
          <span className={`badge badge-sm ${STATUS_BADGE[id.status] ?? "badge-ghost"}`}>{id.status}</span>
        </div>
        <p className="k-mono text-sm text-base-content/60">{id.full_name}</p>
        {id.description && <p className="text-sm text-base-content/75 mt-2 leading-relaxed">{id.description}</p>}
        {id.location && (
          <p className="flex items-center gap-1 text-xs text-base-content/55 mt-2">
            <MapPinIcon className="h-3.5 w-3.5" /> {id.location}
          </p>
        )}
        {website && (
          <a
            className="flex items-center gap-1 link link-primary text-sm mt-1 break-all"
            href={website}
            target="_blank"
            rel="noreferrer"
          >
            <GlobeAltIcon className="h-4 w-4 shrink-0" /> {website}
          </a>
        )}
        <div className="flex flex-wrap gap-2 border-t border-base-300 pt-3 mt-3">
          {SOCIAL_COLS.map(col => {
            const value = id[col];
            if (!value) return null;
            const href = socialUrl(col, value);
            const label = PROFILE_FIELDS.find(f => f.col === col)?.label ?? col;
            const chip =
              "inline-flex items-center gap-1.5 rounded-field bg-base-200 hover:bg-base-300 transition-colors px-2.5 py-1 text-xs k-mono";
            return href ? (
              <a key={col} className={chip} href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            ) : (
              <span key={col} className={chip}>
                {label}: {value}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ProfileEditor = ({
  id,
  onSave,
  busy,
}: {
  id: EnsIdentity;
  onSave: (f: Record<ProfileCol, string>) => void;
  busy: boolean;
}) => {
  const [form, setForm] = useState<Record<ProfileCol, string>>(
    () =>
      Object.fromEntries(PROFILE_FIELDS.map(f => [f.col, (id[f.col] as string) ?? ""])) as Record<ProfileCol, string>,
  );
  const set = (col: ProfileCol, v: string) => setForm(p => ({ ...p, [col]: v }));
  return (
    <Panel eyebrow="Edit" title="Profile details">
      <div className="grid sm:grid-cols-2 gap-4">
        {PROFILE_FIELDS.map(f => (
          <label key={f.col} className={f.col === "description" ? "block sm:col-span-2" : "block"}>
            <span className="k-eyebrow">{f.label}</span>
            <div className="mt-1 flex items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 focus-within:border-primary transition-colors">
              {f.col === "description" ? (
                <textarea
                  className="w-full bg-transparent py-2.5 outline-none text-sm resize-none"
                  rows={3}
                  placeholder={f.placeholder}
                  value={form[f.col]}
                  onChange={e => set(f.col, e.target.value)}
                />
              ) : (
                <input
                  className="w-full bg-transparent py-2.5 outline-none text-sm"
                  placeholder={f.placeholder}
                  value={form[f.col]}
                  onChange={e => set(f.col, e.target.value)}
                />
              )}
            </div>
          </label>
        ))}
      </div>
      <button className="btn btn-primary gap-2 mt-4" disabled={busy} onClick={() => onSave(form)}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : null}
        {busy ? "Saving…" : "Save profile"}
      </button>
      <p className="text-xs text-base-content/55 mt-2">
        Saved to your ENS resolver (sponsored) and mirrored for fast lookups.
      </p>
    </Panel>
  );
};

/** STEP 3 — Credit identity. Gated on the score's eligibility; mints `<label>.kredito.eth` and lets the business manage its profile. */
export const IdentitySection = ({
  result,
  borrower,
  onBack,
  onNext,
}: {
  result: StoredScore;
  borrower: `0x${string}`;
  onBack: () => void;
  onNext: () => void;
}) => {
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [identity, setIdentity] = useState<EnsIdentity | null>(null);
  const [label, setLabel] = useState("");
  const [avail, setAvail] = useState<{ available?: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/identity/lookup?wallet=${borrower}`);
    const j = await r.json();
    setIdentity(j.identity ?? null);
  }, [borrower]);

  useEffect(() => {
    void refresh();
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
    setBusy(true);
    try {
      const nlabel = normalizeLabel(label);
      const signature = await signMessageAsync({ message: mintMessage(borrower, nlabel) });
      const r = await fetch("/api/identity/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: borrower, label: nlabel, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Mint failed");
      notification.success(`${nlabel}.kredito.eth claimed`);
      await refresh();
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (form: Record<ProfileCol, string>) => {
    if (!identity) return;
    setBusy(true);
    try {
      const clean = sanitizeProfile(form);
      const resolver = process.env.NEXT_PUBLIC_KREDITO_RESOLVER as Hex | undefined;
      if (resolver) {
        const { keys, values } = ensTextRecords(clean);
        if (keys.length) {
          await writeContractAsync({
            address: resolver,
            abi: kreditoResolverAbi,
            functionName: "setTexts",
            args: [labelToNode(identity.label), keys, values],
          });
        }
      }
      const issuedAt = Date.now();
      const signature = await signMessageAsync({
        message: editMessage(borrower, identity.label, profileDigest(clean), issuedAt),
      });
      const r = await fetch(`/api/identity/${identity.label}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: borrower, profile: form, issuedAt, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      notification.success("Profile updated");
      setEditing(false);
      await refresh();
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        step={3}
        eyebrow="Credit identity"
        title="Your Kreditos credit identity"
        subtitle="Your approved score becomes a kredito.eth name — the financial ID you release to the market. It holds your attestation, status and reputation onchain; the score stays private."
      />

      {!result.eligible ? (
        <Panel eyebrow="Access" title="Not eligible yet">
          <p className="rounded-field bg-warning/10 text-warning px-3 py-2 text-sm font-medium">
            This score isn&apos;t eligible for a credit identity. Improve the score, then come back.
          </p>
        </Panel>
      ) : identity ? (
        <div className="grid lg:grid-cols-3 gap-5 items-start">
          <div className="lg:col-span-2">
            <IdentityCard id={identity} />
          </div>
          <div className="space-y-4">
            <Panel eyebrow="Manage" title="Profile">
              <p className="text-sm text-base-content/65">
                Add your website, socials, contact and avatar — stored as ENS records.
              </p>
              <button className="btn btn-outline btn-sm mt-3" onClick={() => setEditing(e => !e)}>
                {editing ? "Close editor" : "Edit profile"}
              </button>
            </Panel>
          </div>
          {editing && (
            <div className="lg:col-span-3">
              <ProfileEditor id={identity} onSave={saveProfile} busy={busy} />
            </div>
          )}
        </div>
      ) : (
        <Panel
          eyebrow="Claim"
          title="Mint your .kredito.eth name"
          action={<span className="badge badge-success">approved</span>}
        >
          <label className="block max-w-md">
            <span className="k-eyebrow">Choose your name</span>
            <div className="mt-1 flex">
              <input
                className="flex-1 rounded-l-field border border-base-300 border-r-0 bg-base-100 px-3 py-2.5 outline-none text-sm focus:border-primary"
                placeholder="acme"
                value={label}
                onChange={e => setLabel(e.target.value)}
              />
              <span className="inline-flex items-center rounded-r-field border border-base-300 bg-base-200 px-3 k-mono text-sm text-base-content/60">
                .kredito.eth
              </span>
            </div>
            {avail?.error && <span className="text-error text-xs mt-1 block">{avail.error}</span>}
            {avail?.available === true && <span className="text-success text-xs k-mono mt-1 block">available</span>}
            {avail?.available === false && !avail.error && <span className="text-error text-xs mt-1 block">taken</span>}
          </label>
          <button
            className="btn btn-primary gap-2 mt-4"
            disabled={busy || !label || avail?.available !== true}
            onClick={mint}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : null}
            {busy ? "Minting…" : `Mint ${label || "name"}.kredito.eth`}
          </button>
          <p className="text-xs text-base-content/55 mt-2">You can complete your full profile right after minting.</p>
        </Panel>
      )}

      <div className="flex justify-between mt-6">
        <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <button className="btn btn-primary gap-1" onClick={onNext} type="button">
          Continue to borrow <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};
