"use client";

import { useState } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { FlowShell, PageHeader, Panel, RiskBadge, Stat, StatGrid } from "~~/components/lendsignal";
import { formatUsd } from "~~/lendsignal/format";
import { DEMO_CERTIFICATE, DEMO_LOAN, DEMO_VAULT } from "~~/lendsignal/mock";

const GATES = [
  { label: "Certificate active", ok: true },
  { label: "Not expired", ok: true },
  { label: "Score ≥ 750", ok: true },
  { label: "ENS gate passed", ok: true },
  { label: "Vault has liquidity", ok: true },
];

export default function BorrowPage() {
  const v = DEMO_VAULT;
  const c = DEMO_CERTIFICATE;
  const [amount, setAmount] = useState("10000");
  const [days, setDays] = useState("30");

  const principal = Number(amount) || 0;
  const fee = Math.round((principal * v.originationFeeBps) / 10_000);

  return (
    <FlowShell activeKey="borrow">
      <PageHeader
        step={4}
        eyebrow="Lending vault"
        title="Borrow against the certificate"
        subtitle="The vault re-checks the registry gate (score + ENS) at payout time, then transfers a working-capital loan. No collateral — the certificate is the underwriting."
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Panel
            eyebrow="Request"
            title="New loan"
            action={
              <span className="badge badge-success gap-1.5">
                <CheckCircleIcon className="h-4 w-4" /> Eligible
              </span>
            }
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="ls-eyebrow">Amount (USD)</span>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2.5 ls-mono outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="ls-eyebrow">Duration (days)</span>
                <input
                  value={days}
                  onChange={e => setDays(e.target.value)}
                  className="mt-1 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2.5 ls-mono outline-none focus:border-primary"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-field bg-base-200 px-4 py-3 text-sm">
              <span>
                Origination fee <span className="ls-mono font-semibold">{formatUsd(fee)}</span>{" "}
                <span className="text-base-content/50">({v.originationFeeBps / 100}%)</span>
              </span>
              <span>
                You receive <span className="ls-mono font-semibold">{formatUsd(principal)}</span>
              </span>
              <span className="text-base-content/55">repay {formatUsd(principal + fee)} at maturity</span>
            </div>

            <button className="btn btn-primary mt-4" disabled>
              Request loan
            </button>
            <p className="text-xs text-base-content/45 mt-2">
              Wire to <span className="ls-mono">vault.requestLoan()</span> via{" "}
              <span className="ls-mono">useSponsoredWrite</span> once deployed.
            </p>
          </Panel>

          <Panel eyebrow="Active loan" title={`Loan #${DEMO_LOAN.id}`}>
            <StatGrid cols={4}>
              <Stat label="Principal" value={formatUsd(DEMO_LOAN.principalUsd)} mono />
              <Stat label="Fee" value={formatUsd(DEMO_LOAN.feeUsd)} mono />
              <Stat label="Due" value={`${days} d`} mono />
              <Stat label="Status" value={<span className="badge badge-success badge-sm">Active</span>} />
            </StatGrid>
            <button className="btn btn-ghost border border-base-300 mt-4" disabled>
              Repay {formatUsd(DEMO_LOAN.principalUsd + DEMO_LOAN.feeUsd)}
            </button>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel eyebrow="Gate" title="Approval checks">
            <ul className="space-y-2">
              {GATES.map(g => (
                <li key={g.label} className="flex items-center gap-2 text-sm">
                  {g.ok ? (
                    <CheckCircleIcon className="h-5 w-5 text-success" />
                  ) : (
                    <XCircleIcon className="h-5 w-5 text-error" />
                  )}
                  {g.label}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-base-content/55">Borrower</span>
              <RiskBadge tier={c.riskTier} size="sm" />
            </div>
          </Panel>

          <Panel eyebrow="Vault" title="Liquidity">
            <StatGrid cols={2}>
              <Stat label="Available" value={formatUsd(v.liquidityUsd, true)} mono />
              <Stat label="Outstanding" value={formatUsd(v.totalOutstandingUsd, true)} mono />
              <Stat label="Reserve" value={formatUsd(v.reserveUsd, true)} mono />
              <Stat label="Min score" value={v.minScore} mono />
            </StatGrid>
          </Panel>
        </div>
      </div>
    </FlowShell>
  );
}
