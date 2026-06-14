import type { BorrowerStrength } from "./creditBureau";
import type { BusinessProfile } from "./types";

/**
 * Preloaded demo borrowers (Feature 1). Selecting one auto-fills the onboarding
 * form and attaches small TEXT documents (fast TEE preprocessing) whose content
 * naturally drives the Confidential AI score into the intended band — so the live
 * attested inference is honest, not faked. `strength` also keys the mock bureau.
 */
export type DemoDocument = {
  filename: string;
  /** Plain-text content; the API route base64-encodes it as a resource. */
  content: string;
};

export type DemoProfile = {
  id: string;
  label: string;
  strength: BorrowerStrength;
  /** One-line outcome shown in the picker. */
  outcome: string;
  profile: BusinessProfile;
  documents: DemoDocument[];
};

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "strong",
    label: "Acme Robotics LLC",
    strength: "strong",
    outcome: "Strong — expected to pass (low default risk)",
    profile: {
      legalName: "Acme Robotics LLC",
      dbaName: "Acme Robotics",
      country: "US",
      state: "CA",
      city: "San Jose",
      address: "1200 Innovation Way, San Jose, CA 95110",
      taxIdLast4: "4821",
      industry: "Industrial automation / robotics manufacturing",
      ownerOrPrincipal: { name: "Dana Reyes", role: "CEO", ownershipPct: 60 },
      requestedLoanUsd: 25000,
    },
    documents: [
      {
        filename: "income-statement.txt",
        content: [
          "ACME ROBOTICS LLC — INCOME STATEMENT (Last full year + YTD)",
          "Revenue: $4,200,000 (prior year $3,650,000, +15% YoY)",
          "Cost of goods sold: $2,310,000",
          "Gross profit: $1,890,000 (45% gross margin)",
          "Operating expenses: $1,180,000",
          "EBITDA: $710,000",
          "Net income: $512,000 (12.2% net margin)",
          "YTD (6 months): revenue $2,300,000, net income $290,000.",
        ].join("\n"),
      },
      {
        filename: "bank-summary.txt",
        content: [
          "ACME ROBOTICS LLC — BANK & CASH FLOW SUMMARY (Trailing 12 months)",
          "Average operating account balance: $640,000",
          "Average monthly deposits: $355,000; lowest month $300,000.",
          "No overdrafts or NSF events in the last 24 months.",
          "Operating cash flow (TTM): $620,000. Current ratio: 2.4. Debt-to-equity: 0.35.",
          "Existing debt: one equipment loan, $180,000 remaining, always paid on time.",
        ].join("\n"),
      },
      {
        filename: "legal-and-ar.txt",
        content: [
          "ACME ROBOTICS LLC — LEGAL & RECEIVABLES",
          "Articles of Organization filed 2016 (CA). EIN on file. Licenses current.",
          "A/R aging: $410,000 total, 92% current, 8% 1-30 days, 0% 60+ days.",
          "No liens, judgments, bankruptcies, or UCC defaults on record.",
          "Top 5 customers are investment-grade enterprises on net-30 terms.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "medium",
    label: "Northwind Catering Co.",
    strength: "medium",
    outcome: "Medium — manual review (medium default risk)",
    profile: {
      legalName: "Northwind Catering Co.",
      dbaName: "Northwind Events",
      country: "US",
      state: "IL",
      city: "Chicago",
      address: "84 Lakeside Ave, Chicago, IL 60601",
      taxIdLast4: "7733",
      industry: "Food service / event catering",
      ownerOrPrincipal: { name: "Marco Bianchi", role: "Owner", ownershipPct: 100 },
      requestedLoanUsd: 18000,
    },
    documents: [
      {
        filename: "income-statement.txt",
        content: [
          "NORTHWIND CATERING CO. — INCOME STATEMENT",
          "Revenue: $1,150,000 (prior year $1,210,000, -5% YoY, seasonal).",
          "Gross profit: $402,000 (35% margin).",
          "Operating expenses: $355,000. Net income: $47,000 (4.1% net margin).",
          "Revenue is seasonal: Q4 is ~40% of annual sales.",
        ].join("\n"),
      },
      {
        filename: "bank-summary.txt",
        content: [
          "NORTHWIND CATERING CO. — BANK & CASH FLOW SUMMARY",
          "Average operating balance: $58,000. Two overdraft events in the last 12 months.",
          "Average monthly deposits: $96,000 but swings from $40,000 (off-season) to $190,000.",
          "Existing debt: business credit line $75,000 (62% utilized) + vehicle loan $22,000.",
          "Current ratio: 1.2. Occasional days-beyond-terms on supplier invoices.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "weak",
    label: "Sunset Auto Repair",
    strength: "weak",
    outcome: "Weak — expected to be rejected (high default risk)",
    profile: {
      legalName: "Sunset Auto Repair",
      country: "US",
      state: "AZ",
      city: "Phoenix",
      taxIdLast4: "1090",
      industry: "Automotive repair",
      ownerOrPrincipal: { name: "Jordan Pike", role: "Owner", ownershipPct: 100 },
      requestedLoanUsd: 15000,
    },
    documents: [
      {
        filename: "partial-financials.txt",
        content: [
          "SUNSET AUTO REPAIR — PARTIAL FINANCIALS (incomplete)",
          "Revenue (estimated): $240,000. No formal income statement provided.",
          "Net income: roughly break-even, possibly a small loss.",
          "Bank balance frequently under $3,000; several NSF/overdraft events.",
          "Outstanding: merchant cash advance balance ~$48,000 with daily remittance.",
          "An active lien is on record; tax returns for the last two years are missing.",
          "Business has operated for 14 months.",
        ].join("\n"),
      },
    ],
  },
];

export const getDemoProfile = (id: string): DemoProfile | undefined => DEMO_PROFILES.find(p => p.id === id);
