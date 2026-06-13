// The LendSignal product flow. Drives the header nav, the landing stepper and
// per-page "next step" links so the whole app shares one source of truth.

export type FlowStep = {
  key: string;
  step: number;
  label: string;
  href: string;
  tagline: string;
  summary: string;
};

export const FLOW: FlowStep[] = [
  {
    key: "onboarding",
    step: 1,
    label: "Onboarding",
    href: "/onboarding",
    tagline: "Connect the business wallet",
    summary: "Submit business profile, documents and KYC/KYB. The wallet becomes the credit identity.",
  },
  {
    key: "score",
    step: 2,
    label: "Score",
    href: "/score",
    tagline: "Confidential AI + bureau",
    summary: "Chainlink Confidential AI and the CRS bureau are blended into a single creditworthiness score.",
  },
  {
    key: "certificate",
    step: 3,
    label: "Certificate",
    href: "/certificate",
    tagline: "Soulbound credit NFT",
    summary: "An updateable Credit Certificate is minted as a soulbound NFT, gated by your ENS identity.",
  },
  {
    key: "borrow",
    step: 4,
    label: "Borrow",
    href: "/borrow",
    tagline: "Undercollateralized loan",
    summary: "The vault checks the certificate and ENS gate, then pays out a working-capital loan.",
  },
  {
    key: "liquidity",
    step: 5,
    label: "Liquidity",
    href: "/liquidity",
    tagline: "LPs + default fund",
    summary: "Liquidity providers fund the vault; origination fees build a reserve that covers defaults.",
  },
];

export const flowByKey = (key: string) => FLOW.find(s => s.key === key);
export const nextStep = (key: string) => {
  const i = FLOW.findIndex(s => s.key === key);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : undefined;
};
