import { createServerFn } from "@tanstack/react-start";
import {
  AGE_MINTS,
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

const RPC_TIMEOUT_MS = 2_800;
const HARD_DEADLINE_MS = 8_200;

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

async function rpcBest<T>(
  method: string,
  params: unknown[],
  timeoutMs = RPC_TIMEOUT_MS,
  score: (value: T) => number = () => 1,
): Promise<T> {
  const settled = await Promise.allSettled(
    RPC_ENDPOINTS.map((url) => rpcOnce<T>(url, method, params, timeoutMs)),
  );
  const ok = settled
    .filter((row): row is PromiseFulfilledResult<T> => row.status === "fulfilled")
    .map((row) => row.value);
  if (!ok.length) {
    const last = settled.find((row) => row.status === "rejected") as PromiseRejectedResult | undefined;
    throw last?.reason instanceof Error ? last.reason : new Error("RPC failed");
  }
  ok.sort((a, b) => score(b) - score(a));
  return ok[0];
}

async function rpc<T>(method: string, params: unknown[], timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  return rpcBest<T>(method, params, timeoutMs);
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
    loadedAddresses?: { writable?: string[]; readonly?: string[] };
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

function minTime(times: Array<number | null | undefined>): number | null {
  const ok = times.filter((t): t is number => typeof t === "number");
  return ok.length ? Math.min(...ok) : null;
}

const JUP = new Set<string>(PROGRAMS.jupiter);
const RAY = new Set<string>(PROGRAMS.raydium);
const SERUM = new Set<string>(PROGRAMS.serum);
const ORCA = new Set<string>(PROGRAMS.orca);
const MINT_BY = new Map(TOKENS.map((t) => [t.mint, t]));
const AGE_BY_MINT = new Map(AGE_MINTS.map((t) => [t.mint, t]));

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
  for (const key of tx.meta?.loadedAddresses?.writable ?? []) ids.add(key);
  for (const key of tx.meta?.loadedAddresses?.readonly ?? []) ids.add(key);
  return ids;
}

async function signaturesFor(
  address: string,
  opts: { limit: number; before?: string },
): Promise<Signature[]> {
  const params: Record<string, unknown> = { limit: opts.limit };
  if (opts.before) params.before = opts.before;
  return rpcBest<Signature[]>(
    "getSignaturesForAddress",
    [address, params],
    RPC_TIMEOUT_MS,
    (value) => (Array.isArray(value) ? value.length : 0),
  );
}

async function rewindHistory(
  address: string,
  firstPage: Signature[],
  deadline: number,
): Promise<{ sigs: Signature[]; exhausted: boolean }> {
  const sigs = [...firstPage];
  let exhausted = firstPage.length < 1000;
  let before = firstPage[firstPage.length - 1]?.signature;
  let pages = 1;
  while (!exhausted && pages < 6 && Date.now() < deadline && before) {
    const oldest = minTime(sigs.map((s) => s.blockTime));
    if (oldest !== null && oldest < YEAR_2024_TS) break;
    let batch: Signature[] = [];
    try {
      batch = await signaturesFor(address, { limit: 1000, before });
    } catch {
      break;
    }
    pages += 1;
    if (!batch.length) {
      exhausted = true;
      break;
    }
    sigs.push(...batch);
    if (batch.length < 1000) {
      exhausted = true;
      break;
    }
    before = batch[batch.length - 1]?.signature;
  }
  return { sigs, exhausted };
}

async function oldestSignatureTime(address: string, deadline: number): Promise<number | null> {
  if (Date.now() > deadline) return null;
  try {
    const batch = await signaturesFor(address, { limit: 1000 });
    return minTime(batch.map((s) => s.blockTime));
  } catch {
    return null;
  }
}

type LiveToken = { ui: number; raw: bigint; pubkey: string | null };

async function loadTokenAccounts(wallet: string): Promise<{
  live: Record<string, LiveToken>;
  agePubkeys: string[];
}> {
  const empty = (): LiveToken => ({ ui: 0, raw: 0n, pubkey: null });
  const live: Record<string, LiveToken> = {};
  for (const t of TOKENS) live[t.id] = empty();
  const agePubkeys: string[] = [];
  const seen = new Set<string>();

  async function ingest(programId: string) {
    const result = await rpcBest<{ value?: TokenAccount[] }>(
      "getTokenAccountsByOwner",
      [wallet, { programId }, { encoding: "jsonParsed" }],
      3_400,
      (value) => value.value?.length ?? 0,
    );
    for (const acc of result.value ?? []) {
      const info = acc.account?.data?.parsed?.info;
      const mint = info?.mint;
      const pubkey = acc.pubkey;
      if (!mint) continue;
      const token = MINT_BY.get(mint);
      if (token) {
        const ta = info?.tokenAmount;
        const raw = BigInt(ta?.amount ?? "0");
        const ui = typeof ta?.uiAmount === "number" ? ta.uiAmount : 0;
        const row = live[token.id];
        row.raw += raw;
        row.ui += ui;
        if (!row.pubkey && pubkey) row.pubkey = pubkey;
      }
      if (pubkey && (token || AGE_BY_MINT.has(mint)) && !seen.has(pubkey)) {
        seen.add(pubkey);
        agePubkeys.push(pubkey);
      }
    }
  }

  const results = await Promise.allSettled([ingest(TOKEN_PROGRAM), ingest(TOKEN_2022_PROGRAM)]);
  if (results.every((r) => r.status === "rejected")) {
    throw new Error("Could not read token accounts");
  }
  return { live, agePubkeys: agePubkeys.slice(0, 8) };
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

function pickDexSamples(sigs: Signature[], max: number): string[] {
  if (!sigs.length) return [];
  const wanted: Signature[] = [];
  wanted.push(...sigs.slice(0, 3));
  wanted.push(...sigs.slice(-5));
  const window = sigs.filter(
    (s) =>
      typeof s.blockTime === "number" &&
      s.blockTime >= HISTORY_START_TS &&
      s.blockTime < YEAR_2024_TS,
  );
  const step = Math.max(1, Math.floor(window.length / 6));
  for (let i = 0; i < window.length && wanted.length < max + 4; i += step) {
    wanted.push(window[i]);
  }
  if (sigs.length > 20) {
    wanted.push(sigs[Math.floor(sigs.length / 2)]);
    wanted.push(sigs[Math.floor(sigs.length * 0.75)]);
  }
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker()));
  return out;
}

async function fetchTx(signature: string): Promise<TxJson | null> {
  try {
    return await rpc<TxJson | null>(
      "getTransaction",
      [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      2_600,
    );
  } catch {
    return null;
  }
}

type DexHit = { jup: boolean; ray: boolean; serum: boolean; orca: boolean };

function emptyDex(): DexHit {
  return { jup: false, ray: false, serum: false, orca: false };
}

function noteDex(dex: DexHit, ids: Set<string>) {
  for (const id of ids) {
    if (JUP.has(id)) dex.jup = true;
    if (RAY.has(id)) dex.ray = true;
    if (SERUM.has(id)) dex.serum = true;
    if (ORCA.has(id)) dex.orca = true;
  }
}

async function detectDex(sigs: Signature[], deadline: number): Promise<DexHit> {
  const dex = emptyDex();
  const sample = pickDexSamples(sigs, 12);
  const txs = await mapLimit(sample, 4, async (signature) => {
    if (Date.now() > deadline) return null;
    return fetchTx(signature);
  });
  for (const tx of txs) {
    if (tx) noteDex(dex, collectProgramIds(tx));
  }
  return dex;
}

function dexNames(dex: DexHit): string {
  return [
    dex.jup ? "Jupiter" : null,
    dex.ray ? "Raydium" : null,
    dex.serum ? "Serum" : null,
    dex.orca ? "Orca" : null,
  ]
    .filter(Boolean)
    .join(" + ");
}

function emptyResult(wallet: string): WalletCheckResult {
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
    rpcBest<unknown>("getBalance", [wallet], 2_800),
    loadTokenAccounts(wallet),
    signaturesFor(wallet, { limit: 1000 }),
    fetchNfts(wallet),
  ]);

  const lamports = balanceRes.status === "fulfilled" ? parseBalance(balanceRes.value) : 0;
  const sol = lamportsToSol(lamports);
  const tokenPack = tokenRes.status === "fulfilled" ? tokenRes.value : null;
  const liveTokens = tokenPack?.live ?? null;
  const tokenError = tokenRes.status === "rejected";
  const firstPage = sigRes.status === "fulfilled" ? sigRes.value : [];
  const nfts = nftRes.status === "fulfilled" ? nftRes.value : null;

  const history =
    firstPage.length && Date.now() < deadline
      ? await rewindHistory(wallet, firstPage, deadline)
      : { sigs: firstPage, exhausted: firstPage.length > 0 && firstPage.length < 1000 };

  const sigs = history.sigs;
  const reachedGenesis = history.exhausted;

  let ataOldest: number | null = null;
  if (tokenPack?.agePubkeys.length && Date.now() < deadline) {
    const times = await Promise.all(
      tokenPack.agePubkeys.map((pk) => oldestSignatureTime(pk, deadline)),
    );
    ataOldest = minTime(times);
  }

  const times = sigs
    .map((s) => s.blockTime)
    .filter((t): t is number => typeof t === "number");
  const oldestOnPage = minTime(times);
  const firstActivity = minTime([oldestOnPage, ataOldest]);
  const confirmed2023 = firstActivity !== null && firstActivity < YEAR_2024_TS;
  const unknown2023 = !reachedGenesis && !confirmed2023 && sigs.length > 0;

  const hasActivity =
    sigs.length > 0 ||
    sol > 0 ||
    Boolean(liveTokens && Object.values(liveTokens).some((t) => t.ui > 0));
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
    label: "On-chain in 2023 or earlier",
    kind: "history",
    hit: confirmed2023,
    points: confirmed2023 ? POINTS.active2023 : 0,
    unavailable: unknown2023,
    detail: confirmed2023
      ? `First seen ${formatDay(firstActivity!)}`
      : unknown2023
        ? `Scanned back to ${oldestOnPage ? formatDay(oldestOnPage) : "recent"} — still paging history`
        : firstActivity
          ? `First activity ${formatDay(firstActivity)} (after 2023)`
          : "No signatures found",
  });

  const tokenAtaOldest: Record<string, number | null> = {};
  if (liveTokens && Date.now() < deadline) {
    await Promise.all(
      TOKENS.map(async (token) => {
        const pk = liveTokens[token.id]?.pubkey;
        if (!pk || Date.now() > deadline) {
          tokenAtaOldest[token.id] = null;
          return;
        }
        tokenAtaOldest[token.id] = await oldestSignatureTime(pk, deadline);
      }),
    );
  }

  for (const token of TOKENS) {
    const live = liveTokens?.[token.id];
    const oldest = tokenAtaOldest[token.id] ?? null;
    const heldNow = (live?.ui ?? 0) > 0;
    const from2023 = oldest !== null && oldest < YEAR_2024_TS;
    breakdown.push({
      id: `hist-${token.id}`,
      label: `${token.symbol} since 2023`,
      kind: "history",
      hit: from2023,
      points: from2023 ? POINTS.historyToken : 0,
      detail: from2023
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
    sigs.length && Date.now() < deadline ? await detectDex(sigs, deadline) : emptyDex();
  const dexHit = dex.jup || dex.ray || dex.serum || dex.orca;
  breakdown.push({
    id: "dex",
    label: "Jupiter / Raydium / Serum",
    kind: "activity",
    hit: dexHit,
    points: dexHit ? POINTS.dexActivity : 0,
    detail: dexHit
      ? `${dexNames(dex)} in scanned history`
      : sigs.length
        ? `No DEX in ${Math.min(12, sigs.length)} txs sampled across this wallet's history`
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
    scannedTo: firstActivity ?? oldestOnPage,
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
