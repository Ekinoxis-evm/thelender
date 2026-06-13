import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { nextStep } from "~~/lendsignal/flow";

/** "Continue to the next step" footer link, derived from the flow config. */
export const NextStepCard = ({ currentKey }: { currentKey: string }) => {
  const next = nextStep(currentKey);
  if (!next) return null;

  return (
    <Link
      href={next.href}
      className="ls-card p-5 flex items-center justify-between gap-4 hover:border-primary/40 transition-colors group"
    >
      <div>
        <p className="ls-eyebrow mb-1">Next · step {next.step.toString().padStart(2, "0")}</p>
        <p className="text-lg font-semibold">{next.label}</p>
        <p className="text-sm text-base-content/65 mt-0.5">{next.summary}</p>
      </div>
      <span className="shrink-0 grid place-items-center h-10 w-10 rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-content transition-colors">
        <ArrowRightIcon className="h-5 w-5" />
      </span>
    </Link>
  );
};
