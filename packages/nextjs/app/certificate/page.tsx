import { CheckBadgeIcon, LockClosedIcon } from "@heroicons/react/24/solid";
import {
  CertificateCard,
  FlowShell,
  HashChip,
  PageHeader,
  Panel,
  RiskBadge,
  Stat,
  StatGrid,
} from "~~/components/lendsignal";
import { STATUS_META, daysUntil, formatDate } from "~~/lendsignal/format";
import { DEMO_CERTIFICATE } from "~~/lendsignal/mock";

export default function CertificatePage() {
  const c = DEMO_CERTIFICATE;
  const status = STATUS_META[c.status];

  return (
    <FlowShell activeKey="certificate">
      <PageHeader
        step={3}
        eyebrow="Credit certificate"
        title="A soulbound credit identity"
        subtitle="Issuing the certificate mints a non-transferable ERC-721 to the business wallet, with fully onchain art that updates as the score changes."
      />

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="flex justify-center lg:justify-start">
          <CertificateCard cert={c} />
        </div>

        <div className="space-y-5">
          <Panel
            eyebrow="Certificate"
            title="On-chain record"
            action={<span className={`badge ${status.badge}`}>{status.label}</span>}
          >
            <StatGrid cols={3}>
              <Stat label="Score" value={c.combinedScore} mono />
              <Stat label="Risk tier" value={<RiskBadge tier={c.riskTier} size="sm" />} />
              <Stat label="Version" value={`v${c.version}`} mono />
              <Stat label="Issued" value={formatDate(c.issuedAt)} />
              <Stat label="Expires" value={formatDate(c.expiresAt)} hint={`${daysUntil(c.expiresAt)} days left`} />
              <Stat label="Token" value="#001" mono />
            </StatGrid>
          </Panel>

          <Panel eyebrow="Identity" title="ENS gate">
            <div className="flex items-center gap-2">
              <CheckBadgeIcon className="h-5 w-5 text-success" />
              <span className="ls-mono">{c.ensName}</span>
              <span className="text-sm text-base-content/55">resolves to the borrower wallet</span>
            </div>
            <p className="mt-2 text-xs text-base-content/55">
              The vault only lends when the linked ENS name resolves back onchain to this wallet — a real gate, not a
              label.
            </p>
          </Panel>

          <Panel eyebrow="Anchors" title="Hashes">
            <div className="flex flex-wrap gap-2">
              <HashChip label="att" value={c.attestationHash} />
              <HashChip label="bureau" value={c.bureauReportHash} />
              <HashChip label="evidence" value={c.evidenceDigest} />
            </div>
          </Panel>

          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <LockClosedIcon className="h-4 w-4" />
            Soulbound — transfers and approvals revert (ERC-5192 <span className="ls-mono">locked</span>).
          </div>
        </div>
      </div>
    </FlowShell>
  );
}
