import { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  step?: number;
  action?: ReactNode;
};

export const PageHeader = ({ eyebrow, title, subtitle, step, action }: PageHeaderProps) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-7">
      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-2">
          {step !== undefined && (
            <span className="ls-mono inline-flex h-6 min-w-6 px-2 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
              {step.toString().padStart(2, "0")}
            </span>
          )}
          {eyebrow && <p className="ls-eyebrow">{eyebrow}</p>}
        </div>
        <h1 className="ls-display text-3xl sm:text-4xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-2 text-base-content/70 leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};
