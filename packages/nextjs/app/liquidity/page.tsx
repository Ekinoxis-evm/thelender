"use client";

import { useState } from "react";
import { ArrowRightIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { FlowShell, PageHeader, Panel, Stat, StatGrid } from "~~/components/kredito";
import { formatUsd } from "~~/kredito/format";
import { DEMO_VAULT } from "~~/kredito/mock";

export default function LiquidityPage() {
  const v = DEMO_VAULT;
  const [amount, setAmount] = useState("25000");
  const utilization = Math.round((v.totalOutstandingUsd / (v.liquidityUsd + v.totalOutstandingUsd)) * 100);

  return (
    <FlowShell activeKey="liquidity">
      <PageHeader
        step={5}
        eyebrow="Liquidity & default fund"
        title="Fund the vault, earn the fees"
        subtitle="Liquidity providers supply the loan asset. Origination fees accrue into a protection reserve that reimburses the LP pool when a loan defaults."
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Panel eyebrow="Provide liquidity" title="Deposit">
            <label className="block">
              <span className="k-eyebrow">Amount (USD)</span>
              <input
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="mt-1 w-full rounded-field border border-base-300 bg-base-100 px-3 py-2.5 k-mono outline-none focus:border-primary"
              />
            </label>
            <button className="btn btn-primary mt-4" disabled>
              Deposit liquidity
            </button>
            <p className="text-xs text-base-content/45 mt-2">
              Wire to <span className="k-mono">vault.deposit()</span> (or an approve+deposit batch via{" "}
              <span className="k-mono">sendCalls</span>) once deployed.
            </p>
          </Panel>

          <Panel eyebrow="How protection works" title="Fee flow">
            <div className="flex flex-col sm:flex-row items-stretch gap-3">
              {[
                { t: "Borrower fee", d: "3% origination charged at repayment" },
                { t: "Protection reserve", d: "Fees accrue into the default fund" },
                { t: "Reimburse LPs", d: "On default, reserve refills liquidity" },
              ].map((s, i) => (
                <div key={s.t} className="flex items-center gap-3 flex-1">
                  <div className="rounded-field bg-base-200 px-4 py-3 flex-1">
                    <p className="font-medium text-sm">{s.t}</p>
                    <p className="text-xs text-base-content/55">{s.d}</p>
                  </div>
                  {i < 2 && <ArrowRightIcon className="h-4 w-4 text-base-content/30 shrink-0 hidden sm:block" />}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel eyebrow="Pool" title="Vault state">
            <StatGrid cols={2}>
              <Stat label="Liquidity" value={formatUsd(v.liquidityUsd, true)} mono />
              <Stat label="Outstanding" value={formatUsd(v.totalOutstandingUsd, true)} mono />
              <Stat label="Reserve" value={formatUsd(v.reserveUsd, true)} mono />
              <Stat label="Utilization" value={`${utilization}%`} mono />
            </StatGrid>
            <div className="mt-4 h-2.5 w-full rounded-full bg-base-200 overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${utilization}%` }} />
            </div>
          </Panel>

          <Panel eyebrow="Default fund" title="Protection">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheckIcon className="h-5 w-5 text-success" />
              Covers up to <span className="k-mono font-semibold">{formatUsd(v.reserveUsd)}</span> of defaults
            </div>
            <p className="mt-2 text-xs text-base-content/55">
              Built into the vault — no third contract. On <span className="k-mono">markDefault</span>, the reserve
              moves into liquidity so LPs stay whole.
            </p>
          </Panel>
        </div>
      </div>
    </FlowShell>
  );
}
