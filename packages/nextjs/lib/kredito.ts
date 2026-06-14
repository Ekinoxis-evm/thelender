import { type Hex, keccak256, stringToHex } from "viem";
import { namehash, normalize } from "viem/ens";

/**
 * Shared KreditoOne ENSv2 helpers (safe for both server and client).
 * The parent is `kredito.eth` on ENSv2 (Sepolia). A subname node is the standard ENS namehash,
 * which equals the controller's on-chain `_node` = keccak256(parentNode, keccak256(label)).
 */
export const KREDITO_PARENT_NAME = "kredito.eth";
export const KREDITO_PARENT_NODE = "0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580" as Hex;

export type CreditStatus = "pending" | "approved" | "denied" | "review" | "defaulted";

export type EnsIdentity = {
  label: string;
  wallet_address: string;
  full_name: string | null;
  node: string | null;
  status: CreditStatus;
  display_name: string | null;
  description: string | null;
  avatar_url: string | null;
  header_url: string | null;
  url: string | null;
  email: string | null;
  location: string | null;
  twitter: string | null;
  github: string | null;
  telegram: string | null;
  discord: string | null;
  linkedin: string | null;
  attestation_hash: string | null;
  tx_hash: string | null;
  created_at: string;
};

export const fullName = (label: string) => `${label}.${KREDITO_PARENT_NAME}`;

/**
 * Derive the borrow credit limit (USD) from the combined credit score — there is no user-entered
 * loan amount. Used to set the attestation's `maxPrincipal`. Rounded to the nearest $500.
 *   score >= 750 (low risk):   $10,000 → $50,000 across 750..1000
 *   400..749 (medium risk):    ~$1,000 → ~$10,000 across 400..749 (eligible to request funding)
 *   < 400 (high risk):         $0 (not eligible)
 */
export function creditLimitUsd(score: number): number {
  let usd = 0;
  if (score >= 750) usd = 10_000 + ((Math.min(score, 1000) - 750) / 250) * 40_000;
  else if (score >= 400) usd = 1_000 + ((score - 400) / 350) * 9_000;
  return Math.round(usd / 500) * 500;
}

/** ENSIP-15 normalize and validate a single label (no dots, non-empty). Throws on invalid input. */
export function normalizeLabel(input: string): string {
  const candidate = normalize(input.trim().toLowerCase());
  if (candidate.length === 0 || candidate.includes(".")) {
    throw new Error("Label must be a single normalized name with no dots");
  }
  return candidate;
}

/** ENSv2 node for `<label>.kredito.eth` — matches KreditoController._node and what clients resolve. */
export function labelToNode(label: string): Hex {
  return namehash(fullName(label));
}

/**
 * The exact message a wallet must sign to authorize minting its own identity. Binds the wallet AND
 * the (normalized) label, so the server can prove the caller controls `wallet` before minting.
 * Build with the NORMALIZED label on both client and server so the strings match.
 */
export const mintMessage = (wallet: string, normalizedLabel: string) =>
  `KreditoOne — claim credit identity\nname: ${normalizedLabel}.${KREDITO_PARENT_NAME}\nwallet: ${wallet}`;

/**
 * Edit-profile challenge. Binds the wallet, the label, a digest of the exact profile content, AND a
 * timestamp — so a captured signature can't be replayed to set DIFFERENT content (content-bound) and
 * is only valid briefly (TTL enforced server-side). See profileDigest().
 */
export const editMessage = (wallet: string, normalizedLabel: string, profileDigest: string, issuedAt: number) =>
  `KreditoOne — edit profile\nname: ${normalizedLabel}.${KREDITO_PARENT_NAME}\nwallet: ${wallet}\nprofile: ${profileDigest}\nissued: ${issuedAt}`;

/** Max age (ms) a signed edit challenge is accepted for. */
export const EDIT_TTL_MS = 5 * 60 * 1000;

export const isHttpUrl = (u?: string | null): u is string => !!u && /^https?:\/\//i.test(u);
const HANDLE_RE = /^[A-Za-z0-9_.-]{1,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isTwitterHandle = (h?: string | null): h is string => !!h && HANDLE_RE.test(h);

export type ProfileKind = "text" | "url" | "handle" | "email";
export type ProfileCol =
  | "display_name"
  | "description"
  | "avatar_url"
  | "header_url"
  | "url"
  | "email"
  | "location"
  | "twitter"
  | "github"
  | "telegram"
  | "discord"
  | "linkedin";

export type ProfileField = { col: ProfileCol; ensKey: string; label: string; kind: ProfileKind; placeholder?: string };

/** Single source of truth: each editable profile field, its ENS text-record key, and validation kind. */
export const PROFILE_FIELDS: ProfileField[] = [
  { col: "display_name", ensKey: "name", label: "Display name", kind: "text", placeholder: "Acme Inc." },
  { col: "description", ensKey: "description", label: "About", kind: "text", placeholder: "What your business does" },
  { col: "avatar_url", ensKey: "avatar", label: "Profile picture URL", kind: "url", placeholder: "https://…" },
  { col: "header_url", ensKey: "header", label: "Background banner URL", kind: "url", placeholder: "https://…" },
  { col: "url", ensKey: "url", label: "Website", kind: "url", placeholder: "https://…" },
  { col: "email", ensKey: "email", label: "Contact email", kind: "email", placeholder: "hello@acme.com" },
  { col: "location", ensKey: "location", label: "Address / location", kind: "text", placeholder: "City, Country" },
  { col: "twitter", ensKey: "com.twitter", label: "X / Twitter", kind: "handle", placeholder: "handle" },
  { col: "github", ensKey: "com.github", label: "GitHub", kind: "handle", placeholder: "handle" },
  { col: "telegram", ensKey: "org.telegram", label: "Telegram", kind: "handle", placeholder: "handle" },
  { col: "discord", ensKey: "com.discord", label: "Discord", kind: "text", placeholder: "name#0000" },
  { col: "linkedin", ensKey: "com.linkedin", label: "LinkedIn", kind: "text", placeholder: "company/acme or URL" },
];

export type ProfileInput = Partial<Record<ProfileCol, string>>;
export type Profile = Record<ProfileCol, string | null>;

function validField(kind: ProfileKind, v: string): boolean {
  switch (kind) {
    case "url":
      return isHttpUrl(v);
    case "handle":
      return HANDLE_RE.test(v);
    case "email":
      return EMAIL_RE.test(v) && v.length <= 254;
    case "text":
      return v.length <= 300;
  }
}

/** Drop/normalize every field by its kind (prevents stored javascript: URLs etc.). */
export function sanitizeProfile(p?: ProfileInput): Profile {
  const out = {} as Profile;
  for (const f of PROFILE_FIELDS) {
    const v = p?.[f.col]?.trim();
    out[f.col] = v && validField(f.kind, v) ? v : null;
  }
  return out;
}

/** Map a sanitized profile to ENS (key,value) pairs for an on-chain resolver.setTexts batch. */
export function ensTextRecords(p: Profile): { keys: string[]; values: string[] } {
  const keys: string[] = [];
  const values: string[] = [];
  for (const f of PROFILE_FIELDS) {
    const v = p[f.col];
    if (v != null) {
      keys.push(f.ensKey);
      values.push(v);
    }
  }
  return { keys, values };
}

/** Deterministic digest of a sanitized profile — what the edit signature commits to (replay-proofing). */
export function profileDigest(p: Profile): Hex {
  const canonical = PROFILE_FIELDS.map(f => `${f.ensKey}=${p[f.col] ?? ""}`).join("\n");
  return keccak256(stringToHex(canonical));
}

/** A safe external link for a social/contact field (for the card). Null if unsupported/invalid. */
export function socialUrl(col: ProfileCol, value: string): string | null {
  switch (col) {
    case "url":
      return isHttpUrl(value) ? value : null;
    case "twitter":
      return HANDLE_RE.test(value) ? `https://x.com/${value}` : null;
    case "github":
      return HANDLE_RE.test(value) ? `https://github.com/${value}` : null;
    case "telegram":
      return HANDLE_RE.test(value) ? `https://t.me/${value}` : null;
    case "linkedin":
      return isHttpUrl(value) ? value : HANDLE_RE.test(value) ? `https://www.linkedin.com/${value}` : null;
    case "email":
      return EMAIL_RE.test(value) ? `mailto:${value}` : null;
    default:
      return null;
  }
}

/** Minimal ABI for the issuer mint/revoke path (full ABI is auto-generated on deploy). */
export const kreditoControllerAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "business", type: "address" },
      { name: "attestationHash", type: "string" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "node", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setStatus",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "status", type: "string" },
    ],
    outputs: [],
  },
  // Reads — availability check (issued[node]) + node derivation.
  {
    type: "function",
    name: "issued",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "nodeOf",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  // Custom errors — so viem decodes reverts into readable messages (esp. AlreadyIssued).
  { type: "error", name: "AlreadyIssued", inputs: [{ name: "node", type: "bytes32" }] },
  { type: "error", name: "ResolverNotSet", inputs: [] },
  { type: "error", name: "SubRegistryNotSet", inputs: [] },
] as const;

/** Minimal ABI for owner-side, sponsored profile writes (batched). */
export const kreditoResolverAbi = [
  {
    type: "function",
    name: "setTexts",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "keys", type: "string[]" },
      { name: "values", type: "string[]" },
    ],
    outputs: [],
  },
] as const;
