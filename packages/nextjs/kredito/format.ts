import type { CertStatus, Hex, RiskTier } from "./types";

export const truncateHex = (hex: string, lead = 6, tail = 4) =>
  hex.length > lead + tail + 2 ? `${hex.slice(0, lead)}…${hex.slice(-tail)}` : hex;

export const formatUsd = (value: number, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(value);

export const formatDate = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export const daysUntil = (unixSeconds: number) =>
  Math.max(0, Math.ceil((unixSeconds * 1000 - Date.now()) / 86_400_000));

type TierMeta = {
  label: string;
  short: string;
  badge: string; // daisyUI badge classes
  text: string;
  dot: string;
};

export const TIER_META: Record<RiskTier, TierMeta> = {
  low: {
    label: "Low default risk",
    short: "LOW RISK",
    badge: "badge-success",
    text: "text-success",
    dot: "bg-success",
  },
  medium: {
    label: "Medium default risk",
    short: "MEDIUM RISK",
    badge: "badge-warning",
    text: "text-warning",
    dot: "bg-warning",
  },
  high: {
    label: "High default risk",
    short: "HIGH RISK",
    badge: "badge-error",
    text: "text-error",
    dot: "bg-error",
  },
};

export const tierForScore = (score: number): RiskTier => (score >= 750 ? "low" : score >= 600 ? "medium" : "high");

export const STATUS_META: Record<CertStatus, { label: string; badge: string }> = {
  none: { label: "Not issued", badge: "badge-ghost" },
  pending: { label: "Pending", badge: "badge-ghost" },
  active: { label: "Active", badge: "badge-success" },
  expired: { label: "Expired", badge: "badge-warning" },
  revoked: { label: "Revoked", badge: "badge-error" },
  defaulted: { label: "Defaulted", badge: "badge-error" },
};

export const isHex = (v: string): v is Hex => /^0x[0-9a-fA-F]+$/.test(v);
