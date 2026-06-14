"use client";

import { useState } from "react";
import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { truncateHex } from "~~/kredito/format";

type HashChipProps = {
  value: string;
  label?: string;
  lead?: number;
  tail?: number;
};

/** Mono, truncated, copyable hash/address chip. */
export const HashChip = ({ value, label, lead = 6, tail = 4 }: HashChipProps) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className="group inline-flex items-center gap-2 k-mono text-sm bg-base-200 hover:bg-base-300 transition-colors rounded-lg px-2.5 py-1.5 max-w-full"
    >
      {label && <span className="text-base-content/50 text-xs">{label}</span>}
      <span className="truncate">{truncateHex(value, lead, tail)}</span>
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-success shrink-0" />
      ) : (
        <DocumentDuplicateIcon className="h-3.5 w-3.5 text-base-content/40 group-hover:text-base-content/70 shrink-0" />
      )}
    </button>
  );
};
