import { LOCKIN_STORAGE_KEY } from "@/lib/config";
import type { BreakdownRow } from "@/lib/types";

export type LockInRecord = {
  wallet: string;
  score: number;
  allocation: number;
  breakdown: BreakdownRow[];
  lockedAt: string;
  tasks: Record<string, boolean>;
};

function readAll(): LockInRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCKIN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LockInRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: LockInRecord[]) {
  window.localStorage.setItem(LOCKIN_STORAGE_KEY, JSON.stringify(rows));
}

export function getLockIn(wallet: string): LockInRecord | null {
  const needle = wallet.trim();
  return readAll().find((row) => row.wallet === needle) ?? null;
}

export function saveLockIn(record: LockInRecord): LockInRecord {
  const rows = readAll();
  const existing = rows.find((row) => row.wallet === record.wallet);
  if (existing) return existing;
  rows.push(record);
  writeAll(rows);
  return record;
}
