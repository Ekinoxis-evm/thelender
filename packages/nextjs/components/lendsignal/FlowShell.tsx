import { ReactNode } from "react";
import { FlowStepper } from "./FlowStepper";
import { NextStepCard } from "./NextStepCard";

/** Shared page frame: stepper on top, content, and a link to the next flow step. */
export const FlowShell = ({ activeKey, children }: { activeKey: string; children: ReactNode }) => (
  <div className="mx-auto max-w-5xl px-5 py-8 w-full">
    <div className="mb-8">
      <FlowStepper activeKey={activeKey} />
    </div>
    {children}
    <div className="mt-8">
      <NextStepCard currentKey={activeKey} />
    </div>
  </div>
);
