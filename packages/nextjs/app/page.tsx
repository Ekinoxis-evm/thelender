import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { CertificateCard } from "~~/components/lendsignal";
import { formatUsd } from "~~/lendsignal/format";
import { FLOW } from "~~/lendsignal/flow";
import { DEMO_CERTIFICATE, DEMO_VAULT } from "~~/lendsignal/mock";

export default function OverviewPage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="ls-hero text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="ls-eyebrow text-white/60 mb-4">Onchain credit certification · ENS-gated lending</p>
            <h1 className="ls-display text-4xl sm:text-5xl font-semibold leading-[1.05]">
              Turn a business wallet into a <span className="text-brand-teal">credit identity</span>.
            </h1>
            <p className="mt-5 text-white/70 text-lg leading-relaxed max-w-xl">
              LendSignal blends a Chainlink Confidential AI attestation with a credit-bureau signal into an
              updateable, soulbound <span className="text-white">Credit Certificate</span> — then a vault uses it to
              issue undercollateralized working-capital loans.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/onboarding" className="btn btn-primary">
                Start onboarding
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link href="/certificate" className="btn btn-ghost text-white border border-white/20 hover:bg-white/10">
                See a certificate
              </Link>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <CertificateCard cert={DEMO_CERTIFICATE} />
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-b border-base-300 bg-base-100">
        <div className="mx-auto max-w-6xl px-5 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {[
            { label: "Vault liquidity", value: formatUsd(DEMO_VAULT.liquidityUsd, true) },
            { label: "Default reserve", value: formatUsd(DEMO_VAULT.reserveUsd, true) },
            { label: "Min eligible score", value: DEMO_VAULT.minScore.toString() },
            { label: "Origination fee", value: `${DEMO_VAULT.originationFeeBps / 100}%` },
          ].map(s => (
            <div key={s.label}>
              <p className="ls-eyebrow mb-1">{s.label}</p>
              <p className="ls-mono text-2xl font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Flow */}
      <section className="mx-auto max-w-6xl px-5 py-14 w-full">
        <p className="ls-eyebrow mb-2">How it works</p>
        <h2 className="ls-display text-2xl sm:text-3xl font-semibold mb-8">Five steps, two contracts.</h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FLOW.map(step => (
            <Link
              key={step.key}
              href={step.href}
              className="ls-card p-5 hover:border-primary/40 transition-colors group flex flex-col"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="ls-mono grid place-items-center h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                  {step.step.toString().padStart(2, "0")}
                </span>
                <span className="ls-eyebrow">{step.tagline}</span>
              </div>
              <h3 className="text-lg font-semibold">{step.label}</h3>
              <p className="text-sm text-base-content/65 mt-1 grow">{step.summary}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary font-medium">
                Open
                <ArrowRightIcon className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
