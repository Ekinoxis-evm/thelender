"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { PageHeader, Panel } from "~~/components/kredito";
import { KREDITO_PARENT_NAME } from "~~/lib/kredito";

// Lenient label cleanup for the public lookup — strip any .kredito.eth / .eth suffix and normalize.
// The /identity/<label> page handles validation + not-found.
const cleanLabel = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/\.kredito\.eth$/i, "")
    .replace(/\.eth$/i, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const VerifyPage = () => {
  const router = useRouter();
  const [value, setValue] = useState("");
  const label = cleanLabel(value);

  const lookup = () => {
    if (label) router.push(`/identity/${label}`);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-5 py-10 w-full">
      <PageHeader
        eyebrow="Public verification"
        title="Verify a credit identity"
        subtitle="Anyone can verify a business's Kredito credit credential. Enter its kredito.eth name to see the issuer-signed, onchain-locked approved status and attestation — no account needed."
      />
      <Panel eyebrow="Look up" title="Find a business">
        <div className="join w-full">
          <input
            className="input input-bordered join-item flex-1 k-mono"
            placeholder="acme"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && lookup()}
            autoFocus
          />
          <span className="btn btn-disabled join-item k-mono no-animation">.{KREDITO_PARENT_NAME}</span>
        </div>
        {label && (
          <p className="mt-2 text-xs text-base-content/55">
            Will open <span className="k-mono">{`${label}.${KREDITO_PARENT_NAME}`}</span>
          </p>
        )}
        <button className="btn btn-primary btn-sm w-full gap-1.5 mt-4" onClick={lookup} disabled={!label}>
          <MagnifyingGlassIcon className="h-4 w-4" /> View verified profile
        </button>
        <p className="mt-4 flex items-start gap-2 text-xs text-base-content/50">
          <ShieldCheckIcon className="h-4 w-4 shrink-0 text-success" />
          The approved status and attestation hash are written by the protocol issuer and cannot be edited by the
          business — so the credential is trustworthy without trusting the business itself.
        </p>
      </Panel>
    </div>
  );
};

export default VerifyPage;
