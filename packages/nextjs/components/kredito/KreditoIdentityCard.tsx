"use client";

import Link from "next/link";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { HashChip } from "~~/components/kredito/HashChip";
import { type CreditStatus, PROFILE_FIELDS, type ProfileCol, fullName, isHttpUrl, socialUrl } from "~~/lib/kredito";

/**
 * The subset of an EnsIdentity the card renders. Kept loose (all-optional, `preview`-friendly) so the
 * live editor in KreditoFlow can build it incrementally from form state, while the public page passes
 * a full EnsIdentity. This component is the SINGLE SOURCE OF TRUTH for the credit-identity card visual.
 */
export type IdentityCardData = {
  label: string;
  full_name?: string | null;
  status?: CreditStatus | null;
  display_name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  header_url?: string | null;
  url?: string | null;
  location?: string | null;
  twitter?: string | null;
  github?: string | null;
  telegram?: string | null;
  discord?: string | null;
  linkedin?: string | null;
  email?: string | null;
  attestation_hash?: string | null;
};

const SOCIAL_COLS: ProfileCol[] = ["twitter", "github", "telegram", "linkedin", "discord", "email"];

/** Initials for the avatar fallback — first letters of the display name, else the label. */
const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] ?? "")
    .join("")
    .toUpperCase() || "·";

const statusBadge = (status: CreditStatus | null | undefined) => {
  if (status === "approved") return { cls: "badge-success", label: "Verified · Approved" } as const;
  if (status === "denied") return { cls: "badge-error", label: "Denied" } as const;
  return { cls: "badge-ghost", label: status ?? "Pending" } as const;
};

/**
 * Polished, shareable credit-identity card for `<label>.kredito.eth`. Renders banner, avatar (with
 * initials fallback), display name + the prominent "Verified · Approved" badge, description, website,
 * socials, location, and the attestation hash. Used by the public /identity/<label> page and as a
 * live preview in the profile editor (`preview`).
 */
export const KreditoIdentityCard = ({
  identity,
  preview = false,
}: {
  identity: IdentityCardData;
  preview?: boolean;
}) => {
  const id = identity;
  const name = id.display_name || id.full_name || fullName(id.label);
  const handle = id.full_name || fullName(id.label);
  const banner = isHttpUrl(id.header_url) ? id.header_url : null;
  const avatar = isHttpUrl(id.avatar_url) ? id.avatar_url : null;
  const website = isHttpUrl(id.url) ? id.url : null;
  const badge = statusBadge(id.status);

  return (
    <div className="k-card overflow-hidden w-full">
      {/* Banner — header_url or a brand gradient fallback */}
      {banner ? (
        <div
          className="h-32"
          style={{ backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      ) : (
        <div className="h-32 bg-gradient-to-br from-primary/30 via-primary/10 to-secondary/20" />
      )}

      <div className="px-5 sm:px-6 pb-6">
        {/* Avatar — image or initials fallback */}
        <div className="-mt-12 mb-2">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="w-24 h-24 rounded-full object-cover ring-4 ring-base-100 bg-base-100" />
          ) : (
            <div className="w-24 h-24 rounded-full ring-4 ring-base-100 bg-gradient-to-br from-primary/30 to-secondary/30 grid place-items-center">
              <span className="k-display text-2xl font-semibold text-base-content/70">{initials(name)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="k-display text-2xl font-semibold break-words">{name}</h1>
          <span className={`badge gap-1 ${badge.cls}`}>
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            {badge.label}
          </span>
        </div>
        <p className="k-mono text-sm text-base-content/55 mt-0.5">{handle}</p>

        {id.description && <p className="mt-3 text-sm text-base-content/80 leading-relaxed">{id.description}</p>}

        {(website || id.location) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {id.location && <span className="text-base-content/60">📍 {id.location}</span>}
            {website &&
              (preview ? (
                <span className="link link-primary break-all">{website}</span>
              ) : (
                <a className="link link-primary break-all" href={website} target="_blank" rel="noreferrer">
                  {website}
                </a>
              ))}
          </div>
        )}

        {/* Socials */}
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {SOCIAL_COLS.map(col => {
            const value = id[col];
            if (!value) return null;
            const href = socialUrl(col, value);
            const fieldLabel = PROFILE_FIELDS.find(f => f.col === col)?.label ?? col;
            return href && !preview ? (
              <a key={col} className="link link-primary" href={href} target="_blank" rel="noreferrer">
                {fieldLabel}
              </a>
            ) : (
              <span key={col} className={href ? "link link-primary" : "text-base-content/70"}>
                {fieldLabel}
                {!href && `: ${value}`}
              </span>
            );
          })}
        </div>

        {id.attestation_hash && (
          <div className="mt-4">
            <p className="k-eyebrow mb-1">Attestation hash</p>
            <HashChip value={id.attestation_hash} lead={10} tail={8} />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Compact identity chip — small avatar (or initials) + `<label>.kredito.eth`. Links to the public
 * card unless `preview`/`href={null}`. Used in the header and the onboarding wallet panel.
 */
export const IdentityChip = ({
  identity,
  href,
  hideLabelOnXs = false,
  className = "",
}: {
  identity: Pick<IdentityCardData, "label" | "display_name" | "avatar_url">;
  href?: string | null;
  hideLabelOnXs?: boolean;
  className?: string;
}) => {
  const name = fullName(identity.label);
  const avatar = isHttpUrl(identity.avatar_url) ? identity.avatar_url : null;
  const seed = identity.display_name || identity.label;

  const inner = (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-100 pl-1 pr-3 py-1 hover:bg-base-200 transition-colors ${className}`}
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-6 w-6 rounded-full object-cover bg-base-200 shrink-0" />
      ) : (
        <span className="h-6 w-6 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 grid place-items-center text-[10px] font-semibold text-base-content/70 shrink-0">
          {initials(seed)}
        </span>
      )}
      <span className={`k-mono text-xs truncate max-w-[10rem] ${hideLabelOnXs ? "hidden sm:inline" : ""}`}>{name}</span>
    </span>
  );

  if (href === null) return inner;
  return (
    <Link href={href ?? `/identity/${identity.label}`} className="inline-flex">
      {inner}
    </Link>
  );
};
