"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "~~/components/kredito";
import { Panel } from "~~/components/kredito/Panel";

type AiConfig = {
  model: string;
  credit_system_prompt: string;
  section_system_prompt: string;
  reduce_system_prompt: string;
  profile_system_prompt: string;
  source?: string;
  updated_at?: string;
};
type Check = {
  borrower: string | null;
  eligible: boolean | null;
  risk_tier: string | null;
  combined_score: number | null;
  attested: boolean;
  created_at: string;
};
type Identity = { label: string; full_name: string | null; wallet_address: string; status: string; created_at: string };
type Data = { overview: { checks: Check[]; identities: Identity[] }; aiConfig: AiConfig };

const PROMPT_FIELDS: { key: keyof AiConfig; label: string }[] = [
  { key: "credit_system_prompt", label: "Credit system prompt" },
  { key: "section_system_prompt", label: "Per-document section prompt" },
  { key: "reduce_system_prompt", label: "Reduce / decision prompt" },
  { key: "profile_system_prompt", label: "Off-chain profile prompt" },
];

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem("kredito_admin_secret");
    if (s) setSecret(s);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/admin", { headers: { "x-admin-secret": secret } });
      if (!r.ok) throw new Error(r.status === 401 ? "Wrong admin secret" : "Failed to load");
      const j: Data = await r.json();
      localStorage.setItem("kredito_admin_secret", secret);
      setData(j);
      setCfg(j.aiConfig);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [secret]);

  const saveConfig = async () => {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify(cfg),
      });
      if (!r.ok) throw new Error("Save failed");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 w-full">
      <PageHeader
        eyebrow="Admin"
        title="Kreditos control"
        subtitle="Live status and the AI model + prompt configuration."
      />

      {!data ? (
        <Panel eyebrow="Access" title="Admin secret">
          <div className="flex gap-2 max-w-md">
            <input
              type="password"
              className="input input-bordered flex-1"
              placeholder="ADMIN_SECRET"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load()}
            />
            <button className="btn btn-primary" disabled={busy || !secret} onClick={load}>
              {busy ? "…" : "Unlock"}
            </button>
          </div>
          {error && <p className="text-error text-sm mt-2">{error}</p>}
        </Panel>
      ) : (
        <div className="space-y-6">
          {error && <div className="alert alert-error text-sm">{error}</div>}

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel eyebrow="Status" title={`Recent credit checks (${data.overview.checks.length})`}>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Borrower</th>
                      <th>Score</th>
                      <th>Tier</th>
                      <th>Eligible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overview.checks.map((c, i) => (
                      <tr key={i}>
                        <td className="k-mono text-xs">{short(c.borrower)}</td>
                        <td className="k-mono">{c.combined_score ?? "—"}</td>
                        <td>{c.risk_tier ?? "—"}</td>
                        <td>{c.eligible ? "✓" : "✗"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel eyebrow="Status" title={`Issued identities (${data.overview.identities.length})`}>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Wallet</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overview.identities.map((id, i) => (
                      <tr key={i}>
                        <td className="k-mono text-xs">{id.full_name ?? id.label}</td>
                        <td className="k-mono text-xs">{short(id.wallet_address)}</td>
                        <td>{id.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {cfg && (
            <Panel
              eyebrow="AI configuration"
              title="Model & prompts"
              action={<span className="badge badge-ghost badge-sm">source: {cfg.source}</span>}
            >
              <label className="block max-w-xs mb-4">
                <span className="k-eyebrow">Model</span>
                <input
                  className="input input-bordered w-full mt-1"
                  value={cfg.model}
                  onChange={e => setCfg({ ...cfg, model: e.target.value })}
                />
              </label>
              <div className="space-y-4">
                {PROMPT_FIELDS.map(f => (
                  <label key={f.key} className="block">
                    <span className="k-eyebrow">{f.label}</span>
                    <textarea
                      className="textarea textarea-bordered w-full mt-1 font-mono text-xs"
                      rows={5}
                      value={(cfg[f.key] as string) ?? ""}
                      onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <button className="btn btn-primary mt-4" disabled={busy} onClick={saveConfig}>
                {busy ? "Saving…" : "Save AI config"}
              </button>
              <p className="text-xs text-base-content/55 mt-2">
                Saved as a new active version (history kept). Pipeline consumption of the stored config is wired
                separately.
              </p>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
