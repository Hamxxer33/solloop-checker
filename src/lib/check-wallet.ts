import { createServerFn } from "@tanstack/react-start";
import {
  HISTORY_START_TS,
  NFTS,
  POINTS,
  PROGRAMS,
  RPC_ENDPOINTS,
  TOKENS,
  YEAR_2024_TS,
  computeAllocation,
} from "@/lib/config";
import { isSolanaAddress } from "@/lib/address";
import type { BreakdownRow, WalletCheckResult } from "@/lib/types";

type RpcResult<T> = { result?: T; error?: { message?: string } };

async function rpc<T>(method: string, params: unknown[], timeoutMs = 8_000): Promise<T> {
  let lastError = "RPC failed";
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (compatible; SOLLOOP-checker/1.0)",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `RPC ${res.status}`;
        continue;
      }
      const json = (await res.json()) as RpcResult<T>;
      if (json.error) {
        lastError = json.error.message ?? "RPC error";
        continue;
      }
      if (json.result === undefined) {
        lastError = "Empty RPC result";
        continue;
      }
      return json.result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "RPC failed";
    }
  }
  throw new Error(lastError);
}

type TokenAmount = { amount?: string; uiAmount?: number | null; decimals?: number };
type TokenAccount = {
  pubkey?: string;
  account?: {
    data?: {
      parsed?: { info?: { tokenAmount?: TokenAmount } };
    };
  };
};

type Signature = {
  signature?: string;
  blockTime?: number | null;
};

type ParsedIx = { programId?: string };
type TokenBal = {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null; amount?: string };
};
type TxJson = {
  blockTime?: number | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
      instructions?: ParsedIx[];
    };
  };
  meta?: {
    preTokenBalances?: TokenBal[];
    postTokenBalances?: TokenBal[];
    innerInstructions?: Array<{ instructions?: ParsedIx[] }>;
  };
};

function formatUi(ui: number, symbol: string): string {
  if (ui <= 0) return `0 ${symbol}`;
  const formatted =
    ui >= 1e12
      ? `${(ui / 1e12).toFixed(2)}T`
      : ui >= 1e9
        ? `${(ui / 1e9).toFixed(2)}B`
        : ui >= 1e6
          ? `${(ui / 1e6).toFixed(2)}M`
          : ui.toLocaleString("en-US", {
              maximumFractionDigits: ui >= 1 ? 2 : 4,
            });
  return `${formatted} ${symbol}`;
}

function formatDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () =>
      worker(),
    ),
  );
  return out;
}

async function tokenAccounts(wallet: string, mint: string) {
  const result = await rpc<{ value?: TokenAccount[] }>(
    "getTokenAccountsByOwner",
    [wallet, { mint }, { encoding: "jsonParsed" }],
  );
  let raw = 0n;
  let ui = 0;
  const pubkeys: string[] = [];
  for (const acc of result.value ?? []) {
    if (acc.pubkey) pubkeys.push(acc.pubkey);
    const ta = acc.account?.data?.parsed?.info?.tokenAmount;
    if (!ta) continue;
    raw += BigInt(ta.amount ?? "0");
    ui += typeof ta.uiAmount === "number" ? ta.uiAmount : 0;
  }
  return { raw, ui, pubkeys };
}

async function signaturesFor(
  address: string,
  opts: { limit: number; before?: string },
): Promise<Signature[]> {
  const params: Record<string, unknown> = { limit: opts.limit };
  if (opts.before) params.before = opts.before;
  return rpc<Signature[]>("getSignaturesForAddress", [address, params]);
}

const JUP = new Set<string>(PROGRAMS.jupiter);
const RAY = new Set<string>(PROGRAMS.raydium);
const MINT_BY = new Map(TOKENS.map((t) => [t.mint, t]));

function collectProgramIds(tx: TxJson): Set<string> {
  const ids = new Set<string>();
  const message = tx.transaction?.message;
  for (const key of message?.accountKeys ?? []) {
    if (typeof key === "string") ids.add(key);
    else if (key.pubkey) ids.add(key.pubkey);
  }
  for (const ix of message?.instructions ?? []) {
    if (ix.programId) ids.add(ix.programId);
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions ?? []) {
      if (ix.programId) ids.add(ix.programId);
    }
  }
  return ids;
}

type TokenHist = { maxUi: number; firstTs: number | null; inWindow: boolean };

function emptyHist(): Record<string, TokenHist> {
  const out: Record<string, TokenHist> = {};
  for (const t of TOKENS) out[t.id] = { maxUi: 0, firstTs: null, inWindow: false };
  return out;
}

function noteToken(
  hist: Record<string, TokenHist>,
  mint: string,
  ui: number,
  ts: number | null,
) {
  const token = MINT_BY.get(mint);
  if (!token || ui <= 0) return;
  const row = hist[token.id];
  if (ui > row.maxUi) row.maxUi = ui;
  if (ts && (row.firstTs === null || ts < row.firstTs)) row.firstTs = ts;
  if (ts && ts >= HISTORY_START_TS && ts < YEAR_2024_TS) row.inWindow = true;
  if (ts && ts < YEAR_2024_TS) row.inWindow = true;
}

function ingestTx(
  tx: TxJson,
  wallet: string,
  hist: Record<string, TokenHist>,
  dex: { jup: boolean; ray: boolean },
) {
  const ts = tx.blockTime ?? null;
  const bals = [
    ...(tx.meta?.preTokenBalances ?? []),
    ...(tx.meta?.postTokenBalances ?? []),
  ];
  for (const bal of bals) {
    if (bal.owner && bal.owner !== wallet) continue;
    const ui = bal.uiTokenAmount?.uiAmount;
    if (typeof ui === "number" && bal.mint) noteToken(hist, bal.mint, ui, ts);
  }
  const ids = collectProgramIds(tx);
  for (const id of ids) {
    if (JUP.has(id)) dex.jup = true;
    if (RAY.has(id)) dex.ray = true;
  }
}

async function fetchTx(signature: string): Promise<TxJson | null> {
  try {
    return await rpc<TxJson | null>(
      "getTransaction",
      [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      8_000,
    );
  } catch {
    return null;
  }
}

async function scanAddressHistory(
  address: string,
  maxPages: number,
  deadline: number,
): Promise<{ sigs: Signature[]; exhausted: boolean }> {
  const sigs: Signature[] = [];
  let before: string | undefined;
  let exhausted = false;
  for (let page = 0; page < maxPages; page++) {
    if (Date.now() > deadline) break;
    let batch: Signature[] = [];
    try {
      batch = await signaturesFor(address, { limit: 1000, before });
    } catch {
      break;
    }
    if (!batch.length) {
      exhausted = true;
      break;
    }
    sigs.push(...batch);
    const oldest = batch[batch.length - 1]?.blockTime ?? 0;
    if (oldest && oldest < HISTORY_START_TS) {
      exhausted = true;
      break;
    }
    if (batch.length < 1000) {
      exhausted = true;
      break;
    }
    before = batch[batch.length - 1]?.signature;
    if (!before) break;
  }
  return { sigs, exhausted };
}

function pickSample(sigs: Signature[], max: number): string[] {
  if (!sigs.length) return [];
  const wanted: Signature[] = [];
  const inWindow = sigs.filter(
    (s) =>
      typeof s.blockTime === "number" &&
      s.blockTime >= HISTORY_START_TS &&
      s.blockTime < YEAR_2024_TS,
  );
  const step = Math.max(1, Math.floor(inWindow.length / 10));
  for (let i = 0; i < inWindow.length && wanted.length < 12; i += step) {
    wanted.push(inWindow[i]);
  }
  wanted.push(...sigs.slice(0, 4));
  wanted.push(...sigs.slice(-8));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of wanted) {
    if (!s.signature || seen.has(s.signature)) continue;
    seen.add(s.signature);
    out.push(s.signature);
    if (out.length >= max) break;
  }
  return out;
}

type MeToken = {
  mintAddress?: string;
  collection?: string;
  collectionName?: string;
  name?: string;
};

async function fetchNfts(wallet: string): Promise<MeToken[] | null> {
  try {
    const url = `https://api-mainnet.magiceden.dev/v2/wallets/${encodeURIComponent(wallet)}/tokens?offset=0&limit=100`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; SOLLOOP-checker/1.0)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as MeToken[]) : null;
  } catch {
    return null;
  }
}

function nftHit(tokens: MeToken[], match: string[]): boolean {
  return tokens.some((token) => {
    const blob =
      `${token.collection ?? ""} ${token.collectionName ?? ""} ${token.name ?? ""}`.toLowerCase();
    return match.some((m) => blob.includes(m.toLowerCase()));
  });
}

async function runCheck(wallet: string): Promise<WalletCheckResult> {
  const deadline = Date.now() + 11_000;
  const hist = emptyHist();
  const dex = { jup: false, ray: false };

  const [liveBalances, nfts, walletScan] = await Promise.all([
    Promise.all(
      TOKENS.map(async (token) => {
        try {
          const acc = await tokenAccounts(wallet, token.mint);
          return { token, acc, error: null as string | null };
        } catch (err) {
          return {
            token,
            acc: { raw: 0n, ui: 0, pubkeys: [] as string[] },
            error: err instanceof Error ? err.message : "RPC error",
          };
        }
      }),
    ),
    fetchNfts(wallet),
    scanAddressHistory(wallet, 3, deadline),
  ]);

  const ataPubs = liveBalances.flatMap((row) =>
    row.acc.pubkeys.map((pk) => ({ pk, tokenId: row.token.id, mint: row.token.mint })),
  );

  const ataScans = await Promise.all(
    ataPubs.map(async ({ pk }) => {
      try {
        return await scanAddressHistory(pk, 2, deadline);
      } catch {
        return { sigs: [] as Signature[], exhausted: false };
      }
    }),
  );

  for (let i = 0; i < ataPubs.length; i++) {
    const { mint } = ataPubs[i];
    const scan = ataScans[i];
    const oldest = scan.sigs[scan.sigs.length - 1];
    const ts = oldest?.blockTime ?? null;
    const live = liveBalances.find((r) => r.token.mint === mint);
    if (live && live.acc.ui > 0) {
      noteToken(hist, mint, live.acc.ui, ts);
    }
    if (ts && ts < YEAR_2024_TS) {
      noteToken(hist, mint, Math.max(live?.acc.ui ?? 0, 1), ts);
    }
  }

  const sampleSigs = pickSample(walletScan.sigs, 20);
  const txs = await mapLimit(sampleSigs, 5, fetchTx);
  for (const tx of txs) {
    if (tx) ingestTx(tx, wallet, hist, dex);
  }

  const ataOldestSigs = ataScans
    .map((s) => s.sigs[s.sigs.length - 1]?.signature)
    .filter((s): s is string => Boolean(s))
    .slice(0, 8);
  const ataTxs = await mapLimit(ataOldestSigs, 4, fetchTx);
  for (const tx of ataTxs) {
    if (tx) ingestTx(tx, wallet, hist, dex);
  }

  const times = walletScan.sigs
    .map((s) => s.blockTime)
    .filter((t): t is number => typeof t === "number");
  const firstActivity = times.length ? Math.min(...times) : null;
  const scannedTo = times.length ? Math.min(...times) : null;
  const reachedGenesis = walletScan.exhausted;

  const breakdown: BreakdownRow[] = [];

  const tokenSeen2023 = TOKENS.some((t) => {
    const ts = hist[t.id].firstTs;
    return ts !== null && ts < YEAR_2024_TS;
  });
  const confirmed2023 =
    tokenSeen2023 || (firstActivity !== null && firstActivity < YEAR_2024_TS);
  const unknown2023 = !reachedGenesis && !confirmed2023;
  breakdown.push({
    id: "active-2023",
    label: "On-chain in 2023",
    kind: "history",
    hit: confirmed2023,
    points: confirmed2023 ? POINTS.active2023 : 0,
    unavailable: unknown2023,
    detail: confirmed2023
      ? `Activity on or before ${formatDay(
          Math.min(
            ...[firstActivity, ...TOKENS.map((t) => hist[t.id].firstTs)].filter(
              (t): t is number => t !== null && t < YEAR_2024_TS,
            ),
          ),
        )}`
      : unknown2023
        ? `Scanned back to ${scannedTo ? formatDay(scannedTo) : "recent"} — wallet is too busy to reach 2023 this pass`
        : firstActivity
          ? `First activity ${formatDay(firstActivity)} (after 2023)`
          : "No signatures found",
  });

  for (const token of TOKENS) {
    const h = hist[token.id];
    const minUi = token.minUi;
    const hit = h.inWindow || (h.firstTs !== null && h.firstTs < YEAR_2024_TS && h.maxUi >= minUi);
    breakdown.push({
      id: `hist-${token.id}`,
      label: `${token.symbol} since 2023`,
      kind: "history",
      hit,
      points: hit ? POINTS.historyToken : 0,
      detail: hit
        ? h.firstTs
          ? `Held ${formatUi(h.maxUi, token.symbol)} · first seen ${formatDay(h.firstTs)}`
          : `Held ${formatUi(h.maxUi, token.symbol)} in history`
        : h.maxUi > 0
          ? `${formatUi(h.maxUi, token.symbol)} seen after 2023`
          : "No 2023 hold in scanned history",
    });
  }

  for (const { token, acc, error } of liveBalances) {
    if (error) {
      breakdown.push({
        id: `live-${token.id}`,
        label: `${token.symbol} now`,
        kind: "live",
        hit: false,
        points: 0,
        detail: "Could not read live balance",
        unavailable: true,
      });
      continue;
    }
    const hit = acc.ui >= token.minUi && acc.raw > 0n;
    breakdown.push({
      id: `live-${token.id}`,
      label: `${token.symbol} now`,
      kind: "live",
      hit,
      points: hit ? POINTS.liveToken : 0,
      detail: hit
        ? `${formatUi(acc.ui, token.symbol)} on chain now`
        : acc.ui > 0
          ? `${formatUi(acc.ui, token.symbol)} (below min)`
          : "No live balance",
    });
  }

  const dexHit = dex.jup || dex.ray;
  breakdown.push({
    id: "dex",
    label: "Jupiter / Raydium",
    kind: "activity",
    hit: dexHit,
    points: dexHit ? POINTS.dexActivity : 0,
    detail: dexHit
      ? `${[dex.jup ? "Jupiter" : null, dex.ray ? "Raydium" : null].filter(Boolean).join(" + ")} in scanned txs`
      : walletScan.sigs.length
        ? `No Jup/Raydium in ${sampleSigs.length} sampled txs`
        : "No transactions",
  });

  for (const nft of NFTS) {
    if (nfts === null) {
      breakdown.push({
        id: `nft-${nft.id}`,
        label: nft.label,
        kind: "nft",
        hit: false,
        points: 0,
        detail: "NFT index unavailable",
        unavailable: true,
      });
      continue;
    }
    const hit = nftHit(nfts, nft.match);
    breakdown.push({
      id: `nft-${nft.id}`,
      label: nft.label,
      kind: "nft",
      hit,
      points: hit ? POINTS.nft : 0,
      detail: hit ? "Held in wallet" : "Not held",
    });
  }

  const score = breakdown.reduce((sum, row) => sum + row.points, 0);
  return {
    wallet,
    score,
    allocation: computeAllocation(score),
    breakdown,
    checkedAt: new Date().toISOString(),
    firstActivity,
    scannedTo,
    sigsScanned: walletScan.sigs.length,
  };
}

export const checkWallet = createServerFn({ method: "POST" })
  .validator((data: { address: string }) => {
    const address = String(data?.address ?? "").trim();
    if (!isSolanaAddress(address)) {
      throw new Error("Enter a valid Solana wallet address.");
    }
    return { address };
  })
  .handler(async ({ data }) => {
    return runCheck(data.address);
  });
