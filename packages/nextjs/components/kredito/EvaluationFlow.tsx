"use client";

import { useState } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import { CertificateSection } from "~~/components/kredito/CertificateSection";
import { EMPTY_PROFILE, type FormProfile, OnboardingSection } from "~~/components/kredito/OnboardingSection";
import { ScoreSection } from "~~/components/kredito/ScoreSection";
import { ZERO_ADDR } from "~~/components/kredito/flowBits";
import type { StoredScore } from "~~/kredito/scoreStore";
import { useKreditoWallet } from "~~/kredito/useWallet";
import type { SignedAttestation } from "~~/kredito/vault";

// The three evaluation steps a wallet WITHOUT an identity walks to mint one.
const EVAL_STEPS = ["Onboarding", "Score", "Certificate"] as const;

const EvalStepper = ({
  current,
  maxStep,
  onJump,
}: {
  current: number;
  maxStep: number;
  onJump: (i: number) => void;
}) => (
  <div className="k-card p-2 mb-6 flex items-center gap-1 overflow-x-auto">
    {EVAL_STEPS.map((label, i) => {
      const active = i === current;
      const reachable = i <= maxStep;
      const completed = i < current && reachable;
      return (
        <button
          key={label}
          type="button"
          disabled={!reachable}
          onClick={() => onJump(i)}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
            active
              ? "bg-primary text-primary-content"
              : reachable
                ? "hover:bg-base-200 text-base-content/80"
                : "opacity-40 cursor-not-allowed"
          }`}
        >
          <span
            className={`grid place-items-center h-5 w-5 rounded-full text-xs ${
              active ? "bg-primary-content/20" : completed ? "bg-success text-success-content" : "bg-base-300"
            }`}
          >
            {completed ? <CheckIcon className="h-3 w-3" /> : i + 1}
          </span>
          {label}
        </button>
      );
    })}
  </div>
);

/**
 * The "Get your credit identity" path for a wallet WITHOUT a verified identity:
 * Onboarding → Score → Certificate (sign attestation + mint <label>.kredito.eth).
 * On a successful mint we fire `onMinted` so the parent router refetches the identity
 * and flips to the Dashboard. There is no Borrow/Liquidity here — those live in the
 * Dashboard, reachable only once an identity exists.
 */
export const EvaluationFlow = ({ onMinted }: { onMinted: () => void }) => {
  const { address } = useKreditoWallet();
  const borrower = (address ?? ZERO_ADDR) as `0x${string}`;

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  const [profile, setProfile] = useState<FormProfile>(EMPTY_PROFILE);
  const [result, setResult] = useState<StoredScore | null>(null);
  const [att, setAtt] = useState<SignedAttestation | null>(null);

  const jump = (s: number) => s <= maxStep && setStep(s);
  const advance = (s: number) => {
    setMaxStep(m => Math.max(m, s));
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-5 py-8 w-full">
      <EvalStepper current={step} maxStep={maxStep} onJump={jump} />

      {step === 0 && (
        <OnboardingSection
          profile={profile}
          setProfile={setProfile}
          onScored={r => {
            setResult(r);
            advance(1);
          }}
        />
      )}

      {step === 1 && result && <ScoreSection result={result} onBack={() => setStep(0)} onIssue={() => advance(2)} />}

      {step === 2 && result && (
        <CertificateSection
          result={result}
          borrower={borrower}
          legalName={profile.legalName}
          att={att}
          setAtt={setAtt}
          onMinted={() => {
            // Identity is now minted — let the parent flip to the Dashboard.
            onMinted();
          }}
          onBack={() => setStep(1)}
          // After a mint the certificate's own "Continue" CTA flips to the dashboard too.
          onNext={onMinted}
          nextLabel="Go to your dashboard"
        />
      )}
    </div>
  );
};
