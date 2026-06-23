// The Kredito product flow. Drives the header nav, the landing stepper and
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
    tagline: "Confidential AI",
    summary: "Chainlink Confidential AI analyzes your documents in a TEE and returns a single creditworthiness score.",
  },
  {
    key: "certificate",
    step: 3,
    label: "Credit identity",
    href: "/certificate",
    tagline: "Your .kredito.eth name",
    summary: "If eligible, you mint a verifiable <name>.kredito.eth ENS credit identity that carries your score.",
  },
  {
    key: "borrow",
    step: 4,
    label: "Borrow",
    href: "/borrow",
    tagline: "Undercollateralized loan",
    summary: "The vault verifies your ENS identity and a signed attestation, then pays out a working-capital loan.",
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
