"use client";

import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { FLOW } from "~~/kredito/flow";
import { POOL } from "~~/kredito/pool";

/**
 * Logged-out marketing landing. The single CTA triggers the wallet connection;
 * once authenticated the home swaps to the in-page flow (see KreditoFlow).
 */
export const Landing = ({ onConnect }: { onConnect?: () => void }) => {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="k-hero text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="k-eyebrow text-white/60 mb-4">Onchain credit identity · confidential AI</p>
            <h1 className="k-display text-4xl sm:text-5xl font-semibold leading-[1.05]">
              An <span className="text-accent">onchain credit identity</span> for any business wallet.
            </h1>
            <p className="mt-5 text-white/70 text-lg leading-relaxed max-w-xl">
              Kreditos blends a Chainlink Confidential AI attestation with a credit-bureau signal into a single,
              updateable score — recorded onchain as your{" "}
              <span className="text-white">kredito.eth credit identity</span> and released as a private proof to p2p
              funding pools.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button className="btn btn-primary" onClick={onConnect} type="button">
                Connect &amp; start
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-white/50 text-sm">Connect a wallet to begin — it becomes your credit identity.</p>
          </div>

          <div className="flex justify-center lg:justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kredito-lockup-white.svg" alt="Kreditos" className="w-64 max-w-full opacity-95" />
          </div>
        </div>
      </section>

      {/* Pool terms */}
      <section className="border-b border-base-300 bg-base-100">
        <div className="mx-auto max-w-6xl px-5 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {[
            { label: "Default APY", value: `${POOL.aprBps / 100}%` },
            { label: "Min eligible score", value: POOL.minScore.toString() },
            { label: "Origination fee", value: `${POOL.originationFeeBps / 100}%` },
            { label: "Funding model", value: "p2p pools" },
          ].map(s => (
            <div key={s.label}>
              <p className="k-eyebrow mb-1">{s.label}</p>
              <p className="k-mono text-2xl font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 py-14 w-full">
        <p className="k-eyebrow mb-2">How it works</p>
        <h2 className="k-display text-2xl sm:text-3xl font-semibold mb-8">One page, five steps.</h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FLOW.map(step => (
            <div key={step.key} className="k-card p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <span className="k-mono grid place-items-center h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                  {step.step.toString().padStart(2, "0")}
                </span>
                <span className="k-eyebrow">{step.tagline}</span>
              </div>
              <h3 className="text-lg font-semibold">{step.label}</h3>
              <p className="text-sm text-base-content/65 mt-1 grow">{step.summary}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
