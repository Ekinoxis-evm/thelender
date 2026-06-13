import { ReactNode } from "react";

type PanelProps = {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title?: ReactNode;
  action?: ReactNode;
  bodyClassName?: string;
};

/** Branded surface card used across the app. */
export const Panel = ({ children, className = "", eyebrow, title, action, bodyClassName = "" }: PanelProps) => {
  return (
    <section className={`ls-card p-5 sm:p-6 ${className}`}>
      {(eyebrow || title || action) && (
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {eyebrow && <p className="ls-eyebrow mb-1">{eyebrow}</p>}
            {title && <h2 className="text-lg font-semibold leading-tight truncate">{title}</h2>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
};
