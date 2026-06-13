import { TIER_META } from "~~/lendsignal/format";
import type { RiskTier } from "~~/lendsignal/types";

export const RiskBadge = ({ tier, size = "md" }: { tier: RiskTier; size?: "sm" | "md" }) => {
  const meta = TIER_META[tier];
  return (
    <span
      className={`badge ${meta.badge} ${size === "sm" ? "badge-sm" : ""} gap-1.5 font-semibold ls-mono tracking-wide`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot} brightness-75`} />
      {meta.short}
    </span>
  );
};
