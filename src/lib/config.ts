/**
 * SOLLOOP wallet checker — single config.
 * Links, tasks, mints, programs, form, and the allocation formula live here.
 */

export const BRAND = {
  name: "SOLLOOP",
  tagline: "Born on Solana",
  token: "LOOP",
  x: "https://x.com/Solloop",
  xHandle: "@Solloop",
  telegram: "https://t.me/solloopdotfun",
} as const;

/** Allocation = score * ALLOCATION_MULTIPLIER. This is the number posted to the form. */
export const ALLOCATION_MULTIPLIER = 17;

export const HISTORY_START_TS = Date.UTC(2023, 0, 1) / 1000;
export const YEAR_2024_TS = Date.UTC(2024, 0, 1) / 1000;

export const GOOGLE_FORM = {
  action:
    "https://docs.google.com/forms/d/e/1FAIpQLSflpJDgW0RVSwy6OpXZnn_6do1G2lypSDqxTxxOj2uTMzFhTg/formResponse",
  allocationEntry: "entry.105217077",
  walletEntry: "entry.744941183",
} as const;

export const PROJECT = {
  headline: "Solana-native, built for OGs still here",
  body: "SOLLOOP checks a wallet on public Solana RPC — live balances and transaction history from 2023 onward. Read-only. Submit sends only the wallet and its allocation to SOLLOOP.",
  facts: [
    { label: "Chain", value: "Solana" },
    { label: "Token", value: "$LOOP" },
    { label: "History", value: "2023 → now" },
  ],
} as const;

export const TOKENOMICS = {
  symbol: "LOOP",
  chain: "Solana",
  totalSupply: 10_000_000_000,
  supplyLabel: "10 billion",
  note: "Fixed 10 billion supply. 50% is reserved for airdrop and the Solloop NFT, with vesting below. Remaining 50% will be published later.",
  slices: [
    {
      id: "airdrop",
      label: "Airdrop",
      shortLabel: "Airdrop",
      percent: 25,
      amount: 2_500_000_000,
      tone: "accent" as const,
      group: "community" as const,
      detail: "Submitted allocation follows this bucket.",
      vesting: {
        tgePercent: 50,
        cliffMonths: 0,
        durationMonths: 6,
        cadence: "monthly" as const,
        start: "At claim",
        summary: "50% unlocked at claim. Remaining 50% linear over 6 months. No cliff.",
      },
    },
    {
      id: "nft",
      label: "Solloop NFT",
      shortLabel: "NFT",
      percent: 25,
      amount: 2_500_000_000,
      tone: "accent" as const,
      group: "community" as const,
      detail: "NFT sale coming soon. Allocation follows holders.",
      vesting: {
        tgePercent: 0,
        cliffMonths: 0,
        durationMonths: 3,
        cadence: "at-sale" as const,
        start: "NFT sale",
        summary: "Locked until the NFT sale. Then linear over 3 months to holders.",
      },
    },
    {
      id: "remaining",
      label: "Remaining",
      shortLabel: "Rest",
      percent: 50,
      amount: 5_000_000_000,
      tone: "muted" as const,
      group: "unpublished" as const,
      detail: "Remaining half of supply. Breakdown and vesting will be published later.",
      vesting: null,
    },
  ],
} as const;

export type Task = {
  id: string;
  label: string;
  url: string;
  required: boolean;
  enabled: boolean;
  note?: string;
};

export const TASKS: Task[] = [
  {
    id: "x",
    label: "Follow @Solloop on X",
    url: "https://x.com/Solloop",
    required: true,
    enabled: true,
  },
  {
    id: "x-post-2096602961426214940",
    label: "Like, comment, repost, and turn on notifications for this X post",
    url: "https://x.com/Solloop/status/2096602961426214940",
    required: true,
    enabled: true,
  },
  {
    id: "tg",
    label: "Join Telegram",
    url: "https://t.me/solloopdotfun",
    required: true,
    enabled: true,
  },
  {
    id: "nft",
    label: "Hold Solloop NFT",
    url: "#",
    required: false,
    enabled: false,
    note: "Coming soon",
  },
];

export const POINTS = {
  historyToken: 12,
  liveToken: 8,
  active2023: 10,
  dexActivity: 10,
  nft: 14,
} as const;

export type TokenCheck = {
  id: string;
  symbol: string;
  mint: string;
  decimals: number;
  minUi: number;
  minRaw: string;
};

export const TOKENS: TokenCheck[] = [
  {
    id: "bonk",
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    minUi: 10_000,
    minRaw: "1000000000",
  },
  {
    id: "wif",
    symbol: "WIF",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    decimals: 6,
    minUi: 1,
    minRaw: "1000000",
  },
  {
    id: "mew",
    symbol: "MEW",
    mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
    decimals: 5,
    minUi: 1_000,
    minRaw: "100000000",
  },
  {
    id: "popcat",
    symbol: "POPCAT",
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    decimals: 9,
    minUi: 1,
    minRaw: "1000000000",
  },
];

export type NftCheck = {
  id: string;
  label: string;
  collection: string;
  match: string[];
};

export const NFTS: NftCheck[] = [
  {
    id: "madlads",
    label: "Mad Lads NFT",
    collection: "J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w",
    match: ["mad lad", "madlads", "mad_lads"],
  },
  {
    id: "saga",
    label: "Saga Genesis NFT",
    collection: "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC",
    match: ["saga genesis", "saga_genesis", "solana saga"],
  },
];

export const PROGRAMS = {
  jupiter: [
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33Wc4uB",
    "JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL3drEZ",
  ],
  raydium: [
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpjSHYWMBCNwRty",
    "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS",
  ],
} as const;

export const RPC_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
] as const;

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const LOCKIN_STORAGE_KEY = "solloop.submissions.v1";

export function computeAllocation(score: number): number {
  return Math.max(0, Math.trunc(score * ALLOCATION_MULTIPLIER));
}
