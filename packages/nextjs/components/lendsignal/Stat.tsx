import { ReactNode } from "react";

type StatProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
};

export const Stat = ({ label, value, hint, mono }: StatProps) => (
  <div>
    <p className="ls-eyebrow mb-1">{label}</p>
    <p className={`text-xl font-semibold leading-tight ${mono ? "ls-mono" : ""}`}>{value}</p>
    {hint && <p className="text-xs text-base-content/55 mt-0.5">{hint}</p>}
  </div>
);

export const StatGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div
    className={`grid gap-x-6 gap-y-5 ${
      cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4"
    }`}
  >
    {children}
  </div>
);
