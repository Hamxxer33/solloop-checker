import { SOLSCAN_API_KEY } from "@/lib/solscan-key";
import { AGE_MINTS, HISTORY_START_TS, NFTS, TOKENS, YEAR_2024_TS } from "@/lib/config";

const BASE = "https://pro-api.solscan.io/v2.0";
const YEAR_2021_TS = Date.UTC(2021, 0, 1) / 1000;

export type SolscanDex = { jup: boolean; ray: boolean; serum: boolean; orca: boolean };
export type SolscanLiveToken = { ui: number; raw: bigint; pubkey: string | null };

export type SolscanScan = {
  ok: boolean;
  sol: number | null;
  firstActivity: number | null;
  txCount: number;
  live: Record<string, SolscanLiveToken> | null;
  tokenFirst: Record<string, number | null>;
  dex: SolscanDex;
  nftHits: Record<string, boolean> | null;
  transfersScanned: number;
  error?: string;
};

function emptyDex(): SolscanDex {
  return { jup: false, ray: false, serum: false, orca: false };
}

function emptyLive(): Record<string, SolscanLiveToken> {
  const out: Record<string, SolscanLiveToken> = {};
  for (const t of TOKENS) out[t.id] = { ui: 0, raw: 0n, pubkey: null };
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blobOf(value: unknown): string {
  return JSON.stringify(value ?? "").toLowerCase();
}

async function solscanGet(
  path: string,
  params: Record<string, string | number | Array<string | number> | undefined>,
  timeoutMs = 7_000,
): Promise<unknown | null> {
  const key = SOLSCAN_API_KEY;
  if (!key) return null;
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  try {
    const res = await fetch(url, {
      headers: {
        token: key,
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; SOLLOOP-checker/1.0)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function dataOf(json: unknown): unknown {
  const row = asRecord(json);
  if (!row) return null;
  return row.data ?? null;
}

function noteDex(dex: SolscanDex, value: unknown) {
  const blob = blobOf(value);
  if (blob.includes("jupiter") || blob.includes("jup6") || blob.includes("jup4")) dex.jup = true;
  if (blob.includes("raydium")) dex.ray = true;
  if (
    blob.includes("serum") ||
    blob.includes("openbook") ||
    blob.includes("srmq") ||
    blob.includes("9xqewvg816bux9epjhmat23yvvm2zwbrrpzb9pusvfin")
  ) {
    dex.serum = true;
  }
  if (blob.includes("orca") || blob.includes("whirlpool")) dex.orca = true;
}

export async function scanSolscan(wallet: string, deadline: number): Promise<SolscanScan> {
  const dex = emptyDex();
  const tokenFirst: Record<string, number | null> = {};
  for (const t of TOKENS) tokenFirst[t.id] = null;

  if (!SOLSCAN_API_KEY) {
    return {
      ok: false,
      sol: null,
      firstActivity: null,
      txCount: 0,
      live: null,
      tokenFirst,
      dex,
      nftHits: null,
      transfersScanned: 0,
      error: "missing-key",
    };
  }

  const mintBy = new Map(TOKENS.map((t) => [t.mint, t]));
  const nftNeedles = NFTS.map((n) => ({ id: n.id, match: n.match }));

  const [detailJson, tokensJson, nftJson, firstTransfersJson, dexOldJson, dexNewJson] =
    await Promise.all([
      solscanGet("/account/detail", { address: wallet }),
      solscanGet("/account/token-accounts", {
        address: wallet,
        type: "token",
        page: 1,
        page_size: 40,
      }),
      solscanGet("/account/token-accounts", {
        address: wallet,
        type: "nft",
        page: 1,
        page_size: 40,
      }),
      solscanGet("/account/transfer", {
        address: wallet,
        page: 1,
        page_size: 100,
        sort_by: "block_time",
        sort_order: "asc",
        from_time: YEAR_2021_TS,
      }),
      solscanGet("/account/defi/activities", {
        address: wallet,
        page: 1,
        page_size: 100,
        sort_by: "block_time",
        sort_order: "asc",
        from_time: YEAR_2021_TS,
        activity_type: ["ACTIVITY_TOKEN_SWAP", "ACTIVITY_AGG_TOKEN_SWAP"],
      }),
      solscanGet("/account/defi/activities", {
        address: wallet,
        page: 1,
        page_size: 40,
        sort_by: "block_time",
        sort_order: "desc",
        activity_type: ["ACTIVITY_TOKEN_SWAP", "ACTIVITY_AGG_TOKEN_SWAP"],
      }),
    ]);

  const detail = asRecord(dataOf(detailJson));
  const lamports = detail ? num(detail.lamports) : null;
  const sol = lamports === null ? null : lamports / 1_000_000_000;

  const live = emptyLive();
  let liveOk = false;
  for (const row of asArray(dataOf(tokensJson))) {
    const rec = asRecord(row);
    if (!rec) continue;
    liveOk = true;
    const mint = str(rec.token_address || rec.tokenAddress || rec.mint);
    const token = mintBy.get(mint);
    if (!token) continue;
    const ui =
      num(rec.amount_ui) ??
      num(rec.ui_amount) ??
      num(rec.uiAmount) ??
      0;
    const rawStr = str(rec.amount ?? rec.token_amount ?? "0");
    let raw = 0n;
    try {
      raw = BigInt(rawStr.split(".")[0] || "0");
    } catch {
      raw = 0n;
    }
    live[token.id].ui += ui;
    live[token.id].raw += raw;
    if (!live[token.id].pubkey) {
      live[token.id].pubkey = str(rec.token_account || rec.address) || null;
    }
  }

  const nftHits: Record<string, boolean> = {};
  for (const n of NFTS) nftHits[n.id] = false;
  let nftOk = false;
  for (const row of asArray(dataOf(nftJson))) {
    nftOk = true;
    const rec = asRecord(row);
    const text = blobOf(rec);
    for (const n of nftNeedles) {
      if (n.match.some((m) => text.includes(m.toLowerCase()))) nftHits[n.id] = true;
    }
  }

  const firstTransfers = asArray(dataOf(firstTransfersJson));
  let firstActivity: number | null = null;
  let transfersScanned = firstTransfers.length;
  for (const row of firstTransfers) {
    const rec = asRecord(row);
    const ts = rec ? num(rec.block_time) ?? num(rec.time) : null;
    if (ts !== null) firstActivity = firstActivity === null ? ts : Math.min(firstActivity, ts);
    const mint = rec ? str(rec.token_address || rec.tokenAddress) : "";
    const token = mintBy.get(mint);
    if (token && ts !== null) {
      const cur = tokenFirst[token.id];
      tokenFirst[token.id] = cur === null ? ts : Math.min(cur, ts);
    }
  }

  for (const row of [...asArray(dataOf(dexOldJson)), ...asArray(dataOf(dexNewJson))]) {
    const rec = asRecord(row);
    if (!rec) continue;
    noteDex(dex, rec.platform ?? rec);
    const ts = num(rec.block_time);
    if (ts !== null) firstActivity = firstActivity === null ? ts : Math.min(firstActivity, ts);
  }

  if (Date.now() < deadline) {
    const tokenQueries = TOKENS.map((token) =>
      solscanGet("/account/transfer", {
        address: wallet,
        token: token.mint,
        page: 1,
        page_size: 40,
        sort_by: "block_time",
        sort_order: "asc",
        from_time: HISTORY_START_TS,
        to_time: YEAR_2024_TS,
      }),
    );
    const ageQueries = AGE_MINTS.map((token) =>
      solscanGet("/account/transfer", {
        address: wallet,
        token: token.mint,
        page: 1,
        page_size: 10,
        sort_by: "block_time",
        sort_order: "asc",
        from_time: YEAR_2021_TS,
      }),
    );
    const extra = await Promise.all([...tokenQueries, ...ageQueries]);
    extra.forEach((json, idx) => {
      const rows = asArray(dataOf(json));
      transfersScanned += rows.length;
      for (const row of rows) {
        const rec = asRecord(row);
        const ts = rec ? num(rec.block_time) ?? num(rec.time) : null;
        if (ts === null) continue;
        firstActivity = firstActivity === null ? ts : Math.min(firstActivity, ts);
        if (idx < TOKENS.length) {
          const token = TOKENS[idx];
          const cur = tokenFirst[token.id];
          tokenFirst[token.id] = cur === null ? ts : Math.min(cur, ts);
        }
      }
    });
  }

  const ok = Boolean(detailJson || firstTransfersJson || tokensJson || dexOldJson);
  return {
    ok,
    sol,
    firstActivity,
    txCount: transfersScanned,
    live: liveOk ? live : null,
    tokenFirst,
    dex,
    nftHits: nftOk ? nftHits : null,
    transfersScanned,
    error: ok ? undefined : "solscan-failed",
  };
}
