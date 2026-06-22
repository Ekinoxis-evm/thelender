import "server-only";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

/** Sepolia read RPC (Alchemy when keyed, else a public node). */
export function sepoliaRpc() {
  const key = process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : "https://ethereum-sepolia-rpc.publicnode.com";
}

/**
 * Verify `signature` proves control of `wallet` over `message`. Handles plain EOAs AND Privy smart
 * wallets (ERC-1271 / ERC-6492 undeployed). Returns false on any error — never throws. Shared by the
 * routes that must bind an action to a wallet the caller actually controls (mint, attest, scoring).
 */
export async function verifyWalletControl(
  wallet: `0x${string}`,
  message: string,
  signature?: `0x${string}`,
): Promise<boolean> {
  if (!signature) return false;
  try {
    const reader = createPublicClient({ chain: sepolia, transport: http(sepoliaRpc()) });
    return await reader.verifyMessage({ address: wallet, message, signature });
  } catch {
    return false;
  }
}
