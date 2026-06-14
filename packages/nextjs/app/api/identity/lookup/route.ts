import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { normalizeLabel } from "~~/lib/kredito";
import { getDecision, getIdentityByWallet, isLabelTaken } from "~~/services/kredito/identities";

export const runtime = "nodejs";

/**
 * GET /api/identity/lookup?wallet=0x..&label=acme
 * Returns the wallet's approval status + existing identity (non-sensitive), and/or whether a label
 * is available. Never returns the credit score.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get("wallet");
  const labelParam = searchParams.get("label");

  const res: {
    decisionStatus?: string;
    hasIdentity?: boolean;
    identity?: unknown;
    label?: string;
    labelAvailable?: boolean;
    labelError?: string;
  } = {};

  if (wallet && isAddress(wallet)) {
    const decision = await getDecision(wallet);
    res.decisionStatus = decision?.status ?? "none";
    const identity = await getIdentityByWallet(wallet);
    res.hasIdentity = !!identity;
    res.identity = identity;
  }

  if (labelParam) {
    try {
      const label = normalizeLabel(labelParam);
      res.label = label;
      res.labelAvailable = !(await isLabelTaken(label));
    } catch (e) {
      res.label = labelParam;
      res.labelAvailable = false;
      res.labelError = (e as Error).message;
    }
  }

  return NextResponse.json(res);
}
