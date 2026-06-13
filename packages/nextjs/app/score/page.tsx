import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { FlowShell, HashChip, PageHeader, Panel, ScoreMeter, SignalRow } from "~~/components/lendsignal";
import { DEMO_CERTIFICATE } from "~~/lendsignal/mock";

export default function ScorePage() {
  const c = DEMO_CERTIFICATE;

  return (
    <FlowShell activeKey="score">
      <PageHeader
        step={2}
        eyebrow="Creditworthiness score"
        title="Two signals, one score"
        subtitle="A Chainlink Confidential AI attestation and a CRS credit-bureau signal are blended onchain into a single 0–1000 score. The weights live in the registry and are owner-tunable."
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel eyebrow="Result" title="Combined score" className="lg:col-span-2">
          <ScoreMeter score={c.combinedScore} />

          <div className="mt-7 space-y-5">
            <SignalRow
              name="Confidential AI Attester"
              source="Chainlink · runs in a TEE, returns a structured credit result"
              score={c.confidentialAiScore}
              weightBps={7000}
              accent="bg-primary"
            />
            <SignalRow
              name="Credit-risk bureau"
              source="CRS · business credit history, normalized offchain"
              score={c.bureauScore}
              weightBps={3000}
              accent="bg-brand-teal"
            />
          </div>

          <div className="mt-6 rounded-field bg-base-200 px-4 py-3 ls-mono text-sm">
            combinedScore = {c.confidentialAiScore}·70% + {c.bureauScore}·30% ={" "}
            <span className="font-semibold">{c.combinedScore}</span>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel eyebrow="Evidence anchors" title="Onchain hashes">
            <p className="text-sm text-base-content/65 mb-3">
              Raw evidence stays offchain; only these digests are published.
            </p>
            <div className="space-y-2.5">
              <div>
                <p className="ls-eyebrow mb-1">Attestation</p>
                <HashChip value={c.attestationHash} />
              </div>
              <div>
                <p className="ls-eyebrow mb-1">Bureau report</p>
                <HashChip value={c.bureauReportHash} />
              </div>
              <div>
                <p className="ls-eyebrow mb-1">Evidence digest</p>
                <HashChip value={c.evidenceDigest} />
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Policy" title="Eligibility">
            <ul className="text-sm space-y-1.5 text-base-content/75">
              <li>≥ 750 → Low risk</li>
              <li>600–749 → Medium risk</li>
              <li>&lt; 600 → High risk (rejected)</li>
            </ul>
            <Link href="/certificate" className="btn btn-primary btn-sm mt-4">
              Issue certificate
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Panel>
        </div>
      </div>
    </FlowShell>
  );
}
