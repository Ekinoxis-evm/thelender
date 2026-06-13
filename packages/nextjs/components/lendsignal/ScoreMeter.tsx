import { RiskBadge } from "./RiskBadge";
import { TIER_META, tierForScore } from "~~/lendsignal/format";

type ScoreMeterProps = {
  score: number;
  max?: number;
  size?: "md" | "lg";
};

/** Combined-score gauge: big mono number, /1000, and a tier-colored progress bar. */
export const ScoreMeter = ({ score, max = 1000, size = "lg" }: ScoreMeterProps) => {
  const tier = tierForScore(score);
  const meta = TIER_META[tier];
  const pct = Math.min(100, Math.round((score / max) * 100));

  return (
    <div>
      <div className="flex items-end gap-2">
        <span className={`ls-mono font-semibold leading-none ${size === "lg" ? "text-6xl" : "text-4xl"}`}>
          {score}
        </span>
        <span className="ls-mono text-base-content/45 mb-1">/ {max}</span>
        <span className="ml-auto mb-1">
          <RiskBadge tier={tier} />
        </span>
      </div>

      <div className="mt-4 h-2.5 w-full rounded-full bg-base-200 overflow-hidden">
        <div className={`h-full rounded-full ${meta.dot}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2 flex justify-between ls-mono text-[11px] text-base-content/40">
        <span>0</span>
        <span>600</span>
        <span>750</span>
        <span>1000</span>
      </div>
    </div>
  );
};
