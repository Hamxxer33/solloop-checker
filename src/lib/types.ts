export type CheckKind = "history" | "live" | "activity" | "nft";

export type BreakdownRow = {
  id: string;
  label: string;
  kind: CheckKind;
  hit: boolean;
  points: number;
  detail: string;
  unavailable?: boolean;
};

export type WalletCheckResult = {
  wallet: string;
  score: number;
  allocation: number;
  breakdown: BreakdownRow[];
  checkedAt: string;
  firstActivity: number | null;
  scannedTo: number | null;
  sigsScanned: number;
};
