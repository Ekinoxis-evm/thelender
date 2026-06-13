import Link from "next/link";
import { CheckIcon } from "@heroicons/react/24/solid";
import { FLOW } from "~~/lendsignal/flow";

/** Compact horizontal stepper over the LendSignal flow. */
export const FlowStepper = ({ activeKey }: { activeKey?: string }) => {
  const activeIdx = FLOW.findIndex(s => s.key === activeKey);

  return (
    <nav className="ls-card p-2 flex items-center gap-1 overflow-x-auto">
      {FLOW.map((s, i) => {
        const isActive = s.key === activeKey;
        const isDone = activeIdx >= 0 && i < activeIdx;
        return (
          <Link
            key={s.key}
            href={s.href}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
              isActive ? "bg-primary text-primary-content font-medium" : "hover:bg-base-200"
            }`}
          >
            <span
              className={`ls-mono inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                isActive
                  ? "bg-primary-content/20"
                  : isDone
                    ? "bg-success/15 text-success"
                    : "bg-base-200 text-base-content/50"
              }`}
            >
              {isDone ? <CheckIcon className="h-3 w-3" /> : s.step}
            </span>
            <span className={isActive ? "" : "text-base-content/70"}>{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
