"use client";

import {
  ArrowRightIcon,
  CpuChipIcon,
  DocumentCheckIcon,
  LockClosedIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { FLOW } from "~~/kredito/flow";

// Big-number stats for "The problem" band. Kept here so the copy and the
// numbers live together and stay easy to tweak for a pitch.
const PROBLEM_STATS = [
  { value: ">20%", label: "APY LatAm SMEs pay today" },
  { value: "<8%", label: "What developed markets pay" },
  { value: "$1T", label: "Regional SME funding gap" },
  { value: "$320B", label: "LatAm stablecoin volume" },
] as const;

const MECHANISM = [
  { label: "Audited docs", icon: DocumentCheckIcon },
  { label: "Confidential AI (TEE)", icon: CpuChipIcon },
  { label: "On-chain credit score", icon: ShieldCheckIcon },
] as const;

/**
 * Logged-out pitch landing. Reads like a deck — each band is a "slide" with
 * strong typographic hierarchy and big stat numbers. Every CTA triggers
 * `onConnect`, which starts the wallet-login flow; once authenticated the home
 * swaps to the in-page flow (see KreditoFlow).
 */
export const Landing = ({ onConnect }: { onConnect?: () => void }) => {
  return (
    <div className="flex flex-col">
      {/* ── 1 · Hero ────────────────────────────────────────────────── */}
      <section className="k-hero text-white">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28 grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center">
          <div>
            <p className="k-eyebrow text-accent mb-5">Credit-based borrowing for emerging-market SMEs</p>
            <h1 className="k-display text-4xl sm:text-6xl font-semibold leading-[1.02]">
              Today we welcome <span className="text-accent">Kredito</span>.
            </h1>
            <p className="mt-6 text-white/70 text-lg sm:text-xl leading-relaxed max-w-xl">
              A system for credit-based borrowing in DeFi for small, fast-growing companies who need access to capital
              at competitive rates.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button className="btn btn-primary btn-lg" onClick={onConnect} type="button">
                Connect &amp; start
                <ArrowRightIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-4 text-white/50 text-sm">
              Connect a wallet to begin — it becomes your <span className="k-mono text-white/75">.kredito.eth</span>{" "}
              credit identity.
            </p>
          </div>

          {/* Credit-score motif — a clean gauge, no placeholder data */}
          <div className="flex justify-center lg:justify-end">
            <div className="k-card w-full max-w-sm p-7 bg-white/[0.04] border-white/10 text-white backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <p className="k-eyebrow text-white/55">On-chain credit score</p>
                <span className="k-mono text-xs text-accent">attested · TEE</span>
              </div>

              <div className="mt-8 flex items-end gap-3">
                <span className="k-display text-7xl font-semibold leading-none tabular-nums">782</span>
                <span className="k-mono text-white/40 text-sm mb-2">/ 1000</span>
              </div>

              {/* Score track */}
              <div className="mt-6 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-blue-soft to-accent"
                  style={{ width: "78.2%" }}
                />
              </div>
              <div className="mt-2 flex justify-between k-mono text-[11px] text-white/35">
                <span>0</span>
                <span className="text-accent">400 min</span>
                <span>1000</span>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3 text-center">
                <div className="rounded-box bg-white/[0.05] py-3">
                  <p className="k-mono text-lg font-semibold">acme.kredito.eth</p>
                  <p className="k-eyebrow text-white/45 mt-1">Credit identity</p>
                </div>
                <div className="rounded-box bg-white/[0.05] py-3">
                  <p className="k-mono text-lg font-semibold text-accent">Low</p>
                  <p className="k-eyebrow text-white/45 mt-1">Risk tier</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature strip */}
      <section className="border-b border-base-300 bg-base-100">
        <div className="mx-auto max-w-6xl px-5 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {[
            { label: "Score model", value: "Confidential AI" },
            { label: "Runs in", value: "Chainlink TEE" },
            { label: "Score range", value: "0–1000" },
            { label: "Min eligible score", value: "400" },
          ].map(s => (
            <div key={s.label}>
              <p className="k-eyebrow mb-1">{s.label}</p>
              <p className="k-mono text-2xl font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 2 · The problem ─────────────────────────────────────────── */}
      <section className="bg-base-200 border-b border-base-300">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24 w-full">
          <p className="k-eyebrow mb-3">The problem</p>
          <h2 className="k-display text-3xl sm:text-4xl font-semibold max-w-3xl leading-tight">
            Thriving businesses in Latin America are locked out of efficient global capital.
          </h2>

          <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
            {PROBLEM_STATS.map(s => (
              <div key={s.label} className="border-l-2 border-accent/60 pl-4">
                <p className="k-display text-5xl sm:text-6xl font-semibold tabular-nums leading-none">{s.value}</p>
                <p className="mt-3 text-sm text-base-content/55 max-w-[14ch]">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3 · Why solutions fail ──────────────────────────────────── */}
      <section className="bg-base-100 border-b border-base-300">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24 w-full">
          <p className="k-eyebrow mb-3">Why today&apos;s solutions fail</p>
          <h2 className="k-display text-3xl sm:text-4xl font-semibold mb-12">Neither side bridges the gap.</h2>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="k-card p-7 sm:p-8">
              <span className="k-eyebrow text-base-content/45">TradFi</span>
              <h3 className="k-display text-2xl font-semibold mt-2">Too slow and too expensive.</h3>
              <p className="mt-3 text-base-content/60 leading-relaxed">
                Months of paperwork, local risk premiums and intermediaries — by the time capital arrives, the growth
                window has closed.
              </p>
            </div>

            <div className="k-card p-7 sm:p-8">
              <span className="k-eyebrow text-base-content/45">DeFi</span>
              <h3 className="k-display text-2xl font-semibold mt-2">Over-collateralized.</h3>
              <p className="mt-3 text-base-content/60 leading-relaxed">
                You must lock more than you borrow — useless for cash-starved startups.
              </p>
              <div className="mt-6 flex items-center gap-4 rounded-box bg-base-200 px-5 py-4">
                <div>
                  <p className="k-eyebrow text-base-content/45 mb-1">Lock</p>
                  <p className="k-mono text-2xl font-semibold text-base-content/40 line-through decoration-error/70">
                    $15,000
                  </p>
                </div>
                <ArrowRightIcon className="h-5 w-5 text-base-content/30 shrink-0" />
                <div>
                  <p className="k-eyebrow text-base-content/45 mb-1">To borrow</p>
                  <p className="k-mono text-2xl font-semibold">$10,000</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 · The opportunity ─────────────────────────────────────── */}
      <section className="k-hero text-white">
        <div className="mx-auto max-w-5xl px-5 py-20 sm:py-24 w-full text-center">
          <p className="k-eyebrow text-accent mb-5">The opportunity</p>
          <p className="k-display text-2xl sm:text-4xl font-semibold leading-snug">
            Real-world businesses lack surplus assets to lock in smart contracts. Meanwhile LatAm stablecoin volume tops{" "}
            <span className="text-accent">$320B</span>. The liquidity and infrastructure are ready — the bridge is
            missing.
          </p>
        </div>
      </section>

      {/* ── 5 · The solution ────────────────────────────────────────── */}
      <section className="bg-base-100 border-b border-base-300">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24 w-full">
          <p className="k-eyebrow mb-3">The solution</p>
          <h2 className="k-display text-3xl sm:text-5xl font-semibold max-w-3xl leading-tight">
            We bring real-world creditworthiness on-chain to unlock credit-based lending for small business.
          </h2>

          <div className="mt-10 grid lg:grid-cols-[1fr_0.8fr] gap-12 items-start">
            <p className="text-lg text-base-content/70 leading-relaxed">
              Using the <span className="text-base-content font-medium">Chainlink Confidential AI Attester</span>, the
              protocol securely analyzes audited financial documents from emerging-market enterprises inside a TEE —
              extracting ground-truth financial health to generate a reliable, tamper-proof on-chain credit score. By
              replacing heavy upfront collateral with verifiable financial reputation, we unlock capital efficiency for
              SMEs and let global stablecoin liquidity safely fund high-yield, real-world growth.
            </p>

            <div className="k-card p-6">
              <div className="flex items-center gap-2 text-base-content/55">
                <LockClosedIcon className="h-4 w-4" />
                <span className="k-eyebrow">Raw documents never leave the enclave</span>
              </div>
              <ol className="mt-5 flex flex-col gap-3">
                {MECHANISM.map((m, i) => (
                  <li key={m.label} className="flex items-center gap-3">
                    <span className="k-mono grid place-items-center h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
                      {(i + 1).toString().padStart(2, "0")}
                    </span>
                    <m.icon className="h-5 w-5 text-base-content/40 shrink-0" />
                    <span className="font-medium">{m.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6 · How it works (FLOW-driven) ──────────────────────────── */}
      <section className="bg-base-200 border-b border-base-300">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24 w-full">
          <p className="k-eyebrow mb-2">How it works</p>
          <h2 className="k-display text-3xl sm:text-4xl font-semibold mb-10">
            One page, {FLOW.length} steps — wallet to working capital.
          </h2>

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
        </div>
      </section>

      {/* ── 7 · Final CTA ───────────────────────────────────────────── */}
      <section className="k-hero text-white">
        <div className="mx-auto max-w-4xl px-5 py-24 sm:py-28 w-full text-center">
          <p className="k-eyebrow text-accent mb-5">Get started</p>
          <h2 className="k-display text-3xl sm:text-5xl font-semibold leading-tight">
            Turn financial reputation into capital efficiency.
          </h2>
          <p className="mt-5 text-white/70 text-lg max-w-2xl mx-auto leading-relaxed">
            Replace heavy collateral with a verifiable on-chain credit score — and let global stablecoin liquidity fund
            real-world growth.
          </p>
          <div className="mt-9 flex justify-center">
            <button className="btn btn-primary btn-lg" onClick={onConnect} type="button">
              Connect &amp; start
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-4 text-white/50 text-sm">
            Your wallet becomes your <span className="k-mono text-white/75">.kredito.eth</span> credit identity.
          </p>
        </div>
      </section>
    </div>
  );
};
