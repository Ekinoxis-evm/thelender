"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { HashChip, type IdentityCardData, KreditoIdentityCard, PageHeader, Panel } from "~~/components/kredito";
import { ZERO_ADDR, blockscoutAddressUrl } from "~~/components/kredito/flowBits";
import { useSmartWalletSign, useSponsoredWrite } from "~~/hooks/scaffold-eth/useSmartWallet";
import { sepoliaTxUrl } from "~~/kredito/vault";
import {
  type EnsIdentity,
  PROFILE_FIELDS,
  type ProfileCol,
  type ProfileField,
  editMessage,
  ensTextRecords,
  fullName,
  isHttpUrl,
  isTwitterHandle,
  kreditoResolverAbi,
  labelToNode,
  profileDigest,
  sanitizeProfile,
} from "~~/lib/kredito";
import { notification } from "~~/utils/scaffold-eth";

const KREDITO_RESOLVER = (process.env.NEXT_PUBLIC_KREDITO_RESOLVER ?? "") as string;

export const ProfileSection = ({
  borrower,
  mintedLabel,
  onBack,
  onNext,
  // In the dashboard the editor is a standalone tab — hide the wizard footer nav.
  embedded = false,
}: {
  borrower: `0x${string}`;
  mintedLabel: string | null;
  onBack?: () => void;
  onNext?: () => void;
  embedded?: boolean;
}) => {
  const signMessage = useSmartWalletSign();
  const { writeContractSponsored } = useSponsoredWrite();
  const resolverConfigured = KREDITO_RESOLVER.length > 0;

  const [identity, setIdentity] = useState<EnsIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState<string | null>(mintedLabel);
  const [form, setForm] = useState<Record<ProfileCol, string>>(
    () => Object.fromEntries(PROFILE_FIELDS.map(f => [f.col, ""])) as Record<ProfileCol, string>,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setField = (col: ProfileCol, v: string) => setForm(p => ({ ...p, [col]: v }));

  // Resolve the minted identity: prefer the lifted label; otherwise look it up by wallet.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let id: EnsIdentity | null = null;
        if (mintedLabel) {
          const r = await fetch(`/api/identity/${encodeURIComponent(mintedLabel)}`);
          if (r.ok) id = (await r.json()).identity as EnsIdentity;
        }
        if (!id && borrower !== ZERO_ADDR) {
          const r = await fetch(`/api/identity/lookup?wallet=${borrower}`);
          if (r.ok) {
            const j = await r.json();
            if (j?.hasIdentity && j.identity) id = j.identity as EnsIdentity;
          }
        }
        if (cancelled) return;
        setIdentity(id);
        if (id) {
          setLabel(id.label);
          setForm(
            Object.fromEntries(PROFILE_FIELDS.map(f => [f.col, (id[f.col] as string | null) ?? ""])) as Record<
              ProfileCol,
              string
            >,
          );
        }
      } catch {
        // Non-fatal — the form still renders empty so the user can fill it in.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [mintedLabel, borrower]);

  const save = async () => {
    if (!label) {
      notification.error("No minted identity found. Mint your kredito.eth name first.");
      return;
    }
    setSaving(true);
    try {
      const clean = sanitizeProfile(form);
      const node = labelToNode(label);
      const { keys, values } = ensTextRecords(clean);

      // Canonical onchain write: resolver.setTexts (owner-gated, gas-sponsored) — when configured.
      if (resolverConfigured && keys.length > 0) {
        await writeContractSponsored({
          address: KREDITO_RESOLVER as `0x${string}`,
          abi: kreditoResolverAbi,
          functionName: "setTexts",
          args: [node, keys, values],
        });
      }

      // Mirror to Supabase for fast card rendering. The PATCH route requires a content-bound,
      // TTL'd editMessage signature proving wallet control (see app/api/identity/[label]/route.ts).
      const issuedAt = Date.now();
      const signature = await signMessage(editMessage(borrower, label, profileDigest(clean), issuedAt));
      const res = await fetch(`/api/identity/${encodeURIComponent(label)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: borrower, profile: form, issuedAt, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Save failed");
      setIdentity(json.identity as EnsIdentity);
      setSaved(true);
      notification.success(
        resolverConfigured ? "Profile saved onchain and mirrored" : "Profile saved (Supabase mirror)",
      );
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const displayName = label ? fullName(label) : "your credit identity";
  const attestationHash = identity?.attestation_hash ?? null;
  const txHash = identity?.tx_hash ?? null;

  // Live preview identity built from the current form state — drives the card on the right as the
  // user types. Status is "approved" (the issuer-locked credential is already minted at this step).
  const previewIdentity: IdentityCardData = {
    label: label ?? "yourname",
    full_name: identity?.full_name ?? null,
    status: "approved",
    display_name: form.display_name || null,
    description: form.description || null,
    avatar_url: form.avatar_url || null,
    header_url: form.header_url || null,
    url: form.url || null,
    location: form.location || null,
    twitter: form.twitter || null,
    github: form.github || null,
    telegram: form.telegram || null,
    discord: form.discord || null,
    linkedin: form.linkedin || null,
    email: form.email || null,
    attestation_hash: attestationHash,
  };

  // Soft validation hint (warn, don't block) for a single field based on its value + kind.
  const fieldWarning = (col: ProfileCol, kind: ProfileField["kind"], v: string): string | null => {
    const t = v.trim();
    if (!t) return null;
    if (kind === "url" && !isHttpUrl(t)) return "Enter a full https:// URL";
    if ((col === "twitter" || col === "github") && !isTwitterHandle(t)) return "Use a plain handle (no @ or spaces)";
    return null;
  };

  return (
    <>
      <PageHeader
        step={embedded ? undefined : 4}
        eyebrow="Credit identity · profile"
        title="Set up your public profile"
        subtitle="Your kredito.eth identity is a publicly-resolvable onchain credit credential. Add a public profile so anyone can verify your business — the approved status and attestation are issuer-locked and cannot be edited."
      />

      {/* VERIFIED CREDENTIAL HEADER — the publicly-exposed proof of credit */}
      <Panel
        eyebrow="Verified credential"
        title={<span className="k-mono">{displayName}</span>}
        className="mb-5"
        action={
          <span className="badge badge-success gap-1">
            <ShieldCheckIcon className="h-3.5 w-3.5" /> Verified · Approved
          </span>
        }
      >
        <p className="text-sm text-base-content/70">
          This is a publicly-resolvable onchain credit credential. The issuer wrote a locked <code>kredito.status</code>{" "}
          of <span className="k-mono">approved</span> — anyone can verify it without trusting us. You own the name and
          control your profile records, but not the credit status.
        </p>
        {attestationHash && (
          <div className="mt-4">
            <p className="k-eyebrow mb-1">Attestation hash</p>
            <HashChip value={attestationHash} lead={10} tail={8} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {label && (
            <a
              href={`/identity/${label}`}
              target="_blank"
              rel="noreferrer"
              className="link inline-flex items-center gap-1"
            >
              View public card
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
          {txHash && (
            <a
              href={sepoliaTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              className="link inline-flex items-center gap-1"
            >
              Mint transaction
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
          {resolverConfigured && (
            <a
              href={blockscoutAddressUrl(KREDITO_RESOLVER)}
              target="_blank"
              rel="noreferrer"
              className="link inline-flex items-center gap-1"
            >
              Resolver on Blockscout
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </Panel>

      {loading ? (
        <Panel eyebrow="Public profile" title="Edit your profile">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" /> Loading your identity…
          </div>
        </Panel>
      ) : !label ? (
        <Panel eyebrow="Public profile" title="Edit your profile">
          <p className="text-sm text-base-content/65">
            No minted identity was found for this wallet. Go back and mint your{" "}
            <span className="k-mono">.kredito.eth</span> name first.
          </p>
        </Panel>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          {/* Left: the editable form */}
          <Panel eyebrow="Public profile" title="Edit your profile">
            {!resolverConfigured && (
              <div className="alert alert-warning mb-4">
                <span className="text-sm">
                  Resolver not configured (<code>NEXT_PUBLIC_KREDITO_RESOLVER</code> is unset). Onchain text records are
                  skipped — your profile will be saved to the Supabase mirror only.
                </span>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              {PROFILE_FIELDS.map(f => {
                const warning = fieldWarning(f.col, f.kind, form[f.col]);
                return (
                  <label key={f.col} className={f.col === "description" ? "sm:col-span-2 block" : "block"}>
                    <span className="k-eyebrow">{f.label}</span>
                    {f.col === "description" ? (
                      <textarea
                        className="mt-1 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2.5 text-sm outline-none focus:border-primary transition-colors"
                        rows={3}
                        placeholder={f.placeholder}
                        value={form[f.col]}
                        onChange={e => setField(f.col, e.target.value)}
                      />
                    ) : (
                      <input
                        className={`mt-1 w-full rounded-field border bg-base-100 px-3 py-2.5 text-sm outline-none transition-colors ${
                          warning ? "border-warning focus:border-warning" : "border-base-300 focus:border-primary"
                        }`}
                        placeholder={f.placeholder}
                        value={form[f.col]}
                        onChange={e => setField(f.col, e.target.value)}
                      />
                    )}
                    {warning && <span className="mt-1 block text-xs text-warning">{warning}</span>}
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-sm gap-1" onClick={save} disabled={saving} type="button">
                {saving ? (
                  <>
                    <span className="loading loading-spinner loading-xs" /> Saving…
                  </>
                ) : (
                  <>
                    <ShieldCheckIcon className="h-4 w-4" />
                    {resolverConfigured ? "Save profile (onchain · sponsored)" : "Save profile (mirror)"}
                  </>
                )}
              </button>
              {saved && label && (
                <a
                  href={`/identity/${label}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-sm inline-flex items-center gap-1"
                >
                  View public profile
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {saved && (
              <div className="mt-4 rounded-field bg-success/10 px-4 py-3">
                <p className="text-sm font-medium text-success inline-flex items-center gap-1.5">
                  <CheckCircleIcon className="h-5 w-5" /> Profile saved
                </p>
                <p className="mt-1 text-sm text-base-content/65">
                  Your public credit card is live. Next up is borrowing against your attestation.
                </p>
                {!embedded && onNext && (
                  <button className="btn btn-primary btn-sm gap-1 mt-3" onClick={onNext} type="button">
                    Continue to borrow <ArrowRightIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {resolverConfigured && (
              <p className="mt-3 text-xs text-base-content/50">
                <code>setTexts</code> writes your ENS text records through the owner-gated resolver (gas sponsored),
                then the Supabase mirror is updated with a content-bound signature so the public card renders fast.
              </p>
            )}
          </Panel>

          {/* Right: live preview of the public card as the user types */}
          <div className="space-y-2 lg:sticky lg:top-4">
            <p className="k-eyebrow">Live preview · public card</p>
            <KreditoIdentityCard identity={previewIdentity} preview />
          </div>
        </div>
      )}

      {!embedded && (
        <div className="flex justify-between mt-6">
          <button className="btn btn-ghost gap-1" onClick={onBack} type="button">
            <ArrowLeftIcon className="h-4 w-4" /> Back
          </button>
          <button className="btn btn-primary gap-1" onClick={onNext} type="button">
            Continue to borrow <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
};
