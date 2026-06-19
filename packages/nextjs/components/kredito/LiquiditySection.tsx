"use client";

// Backwards-compatible alias. The LP supply/redeem UI now lives in the dedicated
// `LiquidityDashboard` (pool stats + your positions + actions). Kept so any existing import of
// `LiquiditySection` keeps working; new code should import `LiquidityDashboard` directly.
export { LiquidityDashboard as LiquiditySection } from "./LiquidityDashboard";
