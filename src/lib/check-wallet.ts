import { createServerFn } from "@tanstack/react-start";
import {
  HISTORY_START_TS,
  NFTS,
  POINTS,
  PROGRAMS,
  RPC_ENDPOINTS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  TOKENS,
  YEAR_2024_TS,
  computeAllocation,
} from "@/lib/config";
import { isSolanaAddress } from "@/lib/address";
import type { BreakdownRow, WalletCheckResult } from "@/lib/types";

type RpcResult<T> = { result?: T; error?: { message?: string } };

const RPC_TIMEOUT_MS = 3_200;
const HARD_DEADLINE_MS = 7_200;

async function rpcOnce<T>(url: string, method: string, params: unknown[], timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; SOLLOOP-checker/1.0)",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = (await res.json()) as RpcResult<T>;
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  if (json.result === undefined) throw new Error("Empty RPC result");
  return json.result;
}

async function rpc<T>(method: string, params: unknown[], timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  let lastError = "RPC failed";
  for (const url of RPC_ENDPOINTS) {
    try {
      return await rpcOnce<T>(url, method, params, timeoutMs);
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
      parsed?: { info?: { mint?: string; tokenAmount?: TokenAmount } };
    };
  };
};

type Signature = {
  signature?: string;
  blockTime?: number | null;
};

type ParsedIx = { programId?: string };
type TxJson = {
  blockTime?: number | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
      instructions?: ParsedIx[];
    };
  };
  meta?: {
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

function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

function parseBalance(result: unknown): number {
  if (typeof result === "number") return result;
  if (result && typeof result === "object" && "value" in result) {
    const value = (result as { value: unknown }).value;
    if (typeof value === "number") return value;
  }
  return 0;
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

async function signaturesFor(address: string, limit: number): Promise<Signature[]> {
  return rpc<Signature[]>("getSignaturesForAddress", [address, { limit }]);
}

async function oldestSignatureTime(address: string, deadline: number): Promise<number | null> {
  if (Date.now() > deadline) return null;
  try {
    const batch = await signaturesFor(address, 1000);
    if (!batch.length) return null;
    const times = batch
      .map((s) => s.blockTime)
      .filter((t): t is number => typeof t === "number");
    if (!times.length) return null;
    if (batch.length < 1000) return Math.min(...times);
    return Math.min(...times);
  } catch {
    return null;
  }
}

type LiveToken = { ui: number; raw: bigint; pubkey: string | null };

async function loadTokenAccounts(wallet: string): Promise<Record<string, LiveToken>> {
  const empty = (): LiveToken => ({ ui: 0, raw: 0n, pubkey: null });
  const out: Record<string, LiveToken> = {};
  for (const t of TOKENS) out[t.id] = empty();

  async function ingest(programId: string) {
    const result = await rpc<{ value?: TokenAccount[] }>("getTokenAccountsByOwner", [
      wallet,
      { programId },
      { encoding: "jsonParsed" },
    ]);
    for (const acc of result.value ?? []) {
      const info = acc.account?.data?.parsed?.info;
      const mint = info?.mint;
      if (!mint) continue;
      const token = MINT_BY.get(mint);
      if (!token) continue;
      const ta = info?.tokenAmount;
      const raw = BigInt(ta?.amount ?? "0");
      const ui = typeof ta?.uiAmount === "number" ? ta.uiAmount : 0;
      const row = out[token.id];
      row.raw += raw;
      row.ui += ui;
      if (!row.pubkey && acc.pubkey) row.pubkey = acc.pubkey;
    }
  }

  const results = await Promise.allSettled([ingest(TOKEN_PROGRAM), ingest(TOKEN_2022_PROGRAM)]);
  if (results.every((r) => r.status === "rejected")) {
    throw new Error("Could not read token accounts");
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
      signal: AbortSignal.timeout(4_000),
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

async function detectDex(sigs: Signature[], deadline: number): Promise<{ jup: boolean; ray: boolean }> {
  const dex = { jup: false, ray: false };
  const sample = sigs.slice(0, 4).map((s) => s.signature).filter((s): s is string => Boolean(s));
  for (const signature of sample) {
    if (Date.now() > deadline) break;
    try {
      const tx = await rpc<TxJson | null>(
        "getTransaction",
        [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        2_800,
      );
      if (!tx) continue;
      const ids = collectProgramIds(tx);
      for (const id of ids) {
        if (JUP.has(id)) dex.jup = true;
        if (RAY.has(id)) dex.ray = true;
      }
      if (dex.jup && dex.ray) break;
    } catch {
      /* skip */
    }
  }
  return dex;
}

function emptyResult(wallet: string, extra?: Partial<WalletCheckResult>): WalletCheckResult {
  const breakdown: BreakdownRow[] = [
    {
      id: "check",
      label: "Wallet checked",
      kind: "activity",
      hit: true,
      points: POINTS.participate,
      detail: "Valid Solana address — participation allocation",
    },
  ];
  const score = POINTS.participate;
  return {
    wallet,
    score,
    allocation: computeAllocation(score),
    breakdown,
    checkedAt: new Date().toISOString(),
    firstActivity: null,
    scannedTo: null,
    sigsScanned: 0,
    sol: 0,
    txCount: 0,
    ...extra,
  };
}

async function runCheck(wallet: string): Promise<WalletCheckResult> {
  const deadline = Date.now() + HARD_DEADLINE_MS;
  const breakdown: BreakdownRow[] = [];

  breakdown.push({
    id: "check",
    label: "Wallet checked",
    kind: "activity",
    hit: true,
    points: POINTS.participate,
    detail: "Valid Solana address — participation allocation",
  });

  const [balanceRes, tokenRes, sigRes, nftRes] = await Promise.allSettled([
    rpc<unknown>("getBalance", [wallet]),
    loadTokenAccounts(wallet),
    signaturesFor(wallet, 1000),
    fetchNfts(wallet),
  ]);

  const lamports = balanceRes.status === "fulfilled" ? parseBalance(balanceRes.value) : 0;
  const sol = lamportsToSol(lamports);
  const liveTokens = tokenRes.status === "fulfilled" ? tokenRes.value : null;
  const tokenError = tokenRes.status === "rejected";
  const sigs = sigRes.status === "fulfilled" ? sigRes.value : [];
  const nfts = nftRes.status === "fulfilled" ? nftRes.value : null;

  const times = sigs
    .map((s) => s.blockTime)
    .filter((t): t is number => typeof t === "number");
  const oldestOnPage = times.length ? Math.min(...times) : null;
  const reachedGenesis = sigs.length > 0 && sigs.length < 1000;
  const firstActivity = oldestOnPage;
  const confirmed2023 = oldestOnPage !== null && oldestOnPage < YEAR_2024_TS;
  const unknown2023 = !reachedGenesis && !confirmed2023 && sigs.length > 0;

  const hasActivity = sigs.length > 0 || sol > 0 || Boolean(liveTokens && Object.values(liveTokens).some((t) => t.ui > 0));
  breakdown.push({
    id: "active-wallet",
    label: "On-chain wallet",
    kind: "activity",
    hit: hasActivity,
    points: hasActivity ? POINTS.activeWallet : 0,
    detail: hasActivity
      ? `${sigs.length ? `${sigs.length}${reachedGenesis ? "" : "+"} txs` : "balances"} on Solana`
      : "No transactions or balances found",
  });

  const solHit = sol > 0;
  breakdown.push({
    id: "sol",
    label: "SOL balance",
    kind: "live",
    hit: solHit,
    points: solHit ? POINTS.sol : 0,
    unavailable: balanceRes.status === "rejected",
    detail:
      balanceRes.status === "rejected"
        ? "Could not read SOL"
        : solHit
          ? `${sol.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`
          : "0 SOL",
  });

  breakdown.push({
    id: "active-2023",
    label: "On-chain in 2023",
    kind: "history",
    hit: confirmed2023,
    points: confirmed2023 ? POINTS.active2023 : 0,
    unavailable: unknown2023,
    detail: confirmed2023
      ? `Activity on or before ${formatDay(oldestOnPage!)}`
      : unknown2023
        ? `Scanned back to ${oldestOnPage ? formatDay(oldestOnPage) : "recent"} — wallet is too busy to reach 2023 this pass`
        : firstActivity
          ? `First activity ${formatDay(firstActivity)} (after 2023)`
          : "No signatures found",
  });

  const ataOldest: Record<string, number | null> = {};
  if (liveTokens && Date.now() < deadline) {
    const atas = TOKENS.map((t) => liveTokens[t.id]?.pubkey).filter((pk): pk is string => Boolean(pk));
    const remaining = Math.max(400, deadline - Date.now());
    const per = Math.floor(remaining / Math.max(atas.length, 1));
    await Promise.all(
      TOKENS.map(async (token) => {
        const pk = liveTokens[token.id]?.pubkey;
        if (!pk) {
          ataOldest[token.id] = null;
          return;
        }
        if (Date.now() > deadline) {
          ataOldest[token.id] = null;
          return;
        }
        const ts = await oldestSignatureTime(pk, Date.now() + Math.min(per, 2_400));
        ataOldest[token.id] = ts;
      }),
    );
  }

  for (const token of TOKENS) {
    const live = liveTokens?.[token.id];
    const oldest = ataOldest[token.id] ?? null;
    const heldNow = (live?.ui ?? 0) > 0;
    const from2023 = oldest !== null && oldest < YEAR_2024_TS;
    const histHit = from2023;
    breakdown.push({
      id: `hist-${token.id}`,
      label: `${token.symbol} since 2023`,
      kind: "history",
      hit: histHit,
      points: histHit ? POINTS.historyToken : 0,
      detail:
        histHit
          ? `${heldNow && live ? `Held ${formatUi(live.ui, token.symbol)}` : "Token account"} · first ${oldest ? formatDay(oldest) : "2023"}`
          : live && live.ui > 0
            ? `${formatUi(live.ui, token.symbol)} — no 2023 ATA history this pass`
            : "No 2023 hold in scanned history",
    });
  }

  for (const token of TOKENS) {
    if (tokenError || !liveTokens) {
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
    const acc = liveTokens[token.id];
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

  const dex =
    sigs.length && Date.now() < deadline
      ? await detectDex(sigs, deadline)
      : { jup: false, ray: false };
  const dexHit = dex.jup || dex.ray;
  breakdown.push({
    id: "dex",
    label: "Jupiter / Raydium",
    kind: "activity",
    hit: dexHit,
    points: dexHit ? POINTS.dexActivity : 0,
    detail: dexHit
      ? `${[dex.jup ? "Jupiter" : null, dex.ray ? "Raydium" : null].filter(Boolean).join(" + ")} in recent txs`
      : sigs.length
        ? "No Jup/Raydium in recent sampled txs"
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
    scannedTo: oldestOnPage,
    sigsScanned: sigs.length,
    sol,
    txCount: sigs.length,
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
    try {
      return await runCheck(data.address);
    } catch {
      return emptyResult(data.address);
    }
  });
