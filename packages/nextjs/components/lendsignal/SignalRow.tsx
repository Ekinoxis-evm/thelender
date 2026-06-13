type SignalRowProps = {
  name: string;
  source: string;
  score: number;
  weightBps: number;
  max?: number;
  accent?: string; // tailwind bg-* class for the bar
};

/** One credit signal (AI or bureau) with its score, weight and contribution bar. */
export const SignalRow = ({ name, source, score, weightBps, max = 1000, accent = "bg-primary" }: SignalRowProps) => {
  const pct = Math.min(100, Math.round((score / max) * 100));
  const weightPct = weightBps / 100;
  const contribution = Math.round((score * weightBps) / 10_000);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{name}</p>
          <p className="text-xs text-base-content/55 truncate">{source}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="ls-mono text-lg font-semibold leading-none">{score}</p>
          <p className="text-[11px] text-base-content/50 ls-mono">
            ×{weightPct}% → {contribution}
          </p>
        </div>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-base-200 overflow-hidden">
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};
