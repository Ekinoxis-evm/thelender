import { TIER_META } from "~~/lendsignal/format";
import { truncateHex } from "~~/lendsignal/format";
import type { CreditCertificate } from "~~/lendsignal/types";

const TIER_HEX: Record<string, string> = { low: "#16a34a", medium: "#d97706", high: "#dc2626" };

/**
 * The soulbound credit certificate, rendered to match the onchain NFT art
 * (navy card, tier-colored frame, mono score). Visual twin of tokenURI's SVG.
 */
export const CertificateCard = ({ cert, tokenId = 1 }: { cert: CreditCertificate; tokenId?: number }) => {
  const meta = TIER_META[cert.riskTier];
  const color = TIER_HEX[cert.riskTier];
  const subject = cert.ensName ?? truncateHex(cert.borrower);

  return (
    <div
      className="ls-hero relative rounded-[var(--radius-box)] p-6 text-white aspect-square max-w-sm w-full flex flex-col"
      style={{ boxShadow: `inset 0 0 0 2px ${color}33, 0 24px 60px -30px ${color}55` }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="ls-mono text-xs text-white/55">LendSignal</p>
          <p className="ls-display text-lg font-semibold">Credit Certificate</p>
        </div>
        <span className="ls-mono text-xs text-white/45">#{tokenId.toString().padStart(3, "0")}</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        <span className="ls-mono text-7xl font-bold leading-none">{cert.combinedScore}</span>
        <span className="ls-mono text-sm text-white/45 mt-1">/ 1000</span>
        <span
          className="mt-4 ls-mono text-xs font-bold tracking-wider px-4 py-1.5 rounded-full"
          style={{ background: color, color: "#0b1220" }}
        >
          {meta.short}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="ls-mono text-sm">{subject}</p>
          <p className="ls-mono text-xs text-white/45 mt-0.5">Status: {cert.status.toUpperCase()}</p>
        </div>
        <span
          className="ls-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border border-white/15 text-white/60"
          title="Soulbound — non-transferable"
        >
          Soulbound
        </span>
      </div>
    </div>
  );
};
