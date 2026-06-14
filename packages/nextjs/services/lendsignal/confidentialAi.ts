/**
 * Chainlink Confidential AI Attester client — SERVER ONLY.
 *
 * The API key is a secret; this module reads it from a non-public env var and is
 * imported exclusively by the route handler (app/api/lendsignal/score). Never
 * import it from a client component.
 *
 * Flow (https://confidential-ai-dev-preview.cldev.cloud/docs):
 *   POST /v1/inference            -> 202 { id, status: "queued" }
 *   GET  /v1/inference/:id         -> poll until status completed | failed
 *
 * Docs/skill: .agents/skills/chainlink-confidential-ai-attester-skill/SKILL.md
 */
import type { UploadedDocument } from "./types";

// Strip trailing slashes so a base URL like ".../cldev.cloud/" doesn't produce "//v1/...".
const BASE_URL = (
  process.env.CHAINLINK_CONFIDENTIAL_AI_BASE_URL ?? "https://confidential-ai-dev-preview.cldev.cloud"
).replace(/\/+$/, "");
const API_KEY = process.env.CHAINLINK_CONFIDENTIAL_AI_API_KEY ?? "";
const MODEL = process.env.CHAINLINK_CONFIDENTIAL_AI_MODEL ?? "gemma4";

/** True when an API key is configured — otherwise the route uses a mock fallback. */
export const isConfidentialAiConfigured = () => API_KEY.length > 0;

export type InferenceStatus = "queued" | "preparing-resources" | "processing" | "completed" | "failed";

export type InferenceSnapshot = {
  id: string;
  status: InferenceStatus;
  output?: string;
  error?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  resources?: Array<{
    digest?: string;
    request_digest?: string;
    response_digest?: string;
  }>;
};

export type InferenceRequest = {
  prompt: string;
  systemPrompt?: string;
  documents?: UploadedDocument[];
  model?: string;
};

function authHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

/** Submit an inference request. Returns the request id to poll. */
export async function submitInference({
  prompt,
  systemPrompt,
  documents = [],
  model,
}: InferenceRequest): Promise<string> {
  const body = {
    model: model ?? MODEL,
    ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
    prompt,
    resources: documents.map(doc => ({
      filename: doc.filename,
      content_type: doc.contentType,
      content_base64: doc.contentBase64,
    })),
  };

  const res = await fetch(`${BASE_URL}/v1/inference`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Confidential AI submit failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Confidential AI submit returned no request id");
  return json.id;
}

/** Read the current snapshot of a request. */
export async function getInference(id: string): Promise<InferenceSnapshot> {
  const res = await fetch(`${BASE_URL}/v1/inference/${id}`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Confidential AI poll failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as InferenceSnapshot;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Submit then poll to a terminal state. Text documents complete in seconds; PDFs
 * can take minutes (Docling preprocessing), so the demo uses small text docs.
 */
export async function runInference(
  req: InferenceRequest,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<InferenceSnapshot> {
  const intervalMs = opts.intervalMs ?? 3000;
  const maxAttempts = opts.maxAttempts ?? 40; // ~120s ceiling

  const id = await submitInference(req);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs);
    const snapshot = await getInference(id);
    if (snapshot.status === "completed" || snapshot.status === "failed") {
      return snapshot;
    }
  }
  throw new Error(`Confidential AI inference ${id} did not finish within ${(intervalMs * maxAttempts) / 1000}s`);
}
