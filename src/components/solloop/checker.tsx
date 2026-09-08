import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Lock,
  TriangleAlert,
  X,
} from "lucide-react";
import { BRAND, TASKS, type Task } from "@/lib/config";
import { isSolanaAddress } from "@/lib/address";
import { checkWallet } from "@/lib/check-wallet";
import { getLockIn, saveLockIn } from "@/lib/lockin";
import { submitAllocation } from "@/lib/submit-form";
import type { BreakdownRow, WalletCheckResult } from "@/lib/types";
import { cn, formatInt, shortenAddress } from "@/lib/utils";
import { LoopMark, XIcon } from "@/components/solloop/logo";
import { Starfield } from "@/components/solloop/starfield";
import { ProjectAndToken } from "@/components/solloop/tokenomics";

type Phase = "form" | "checking" | "result" | "lockin" | "submitting" | "done";

const KIND_LABEL: Record<BreakdownRow["kind"], string> = {
  history: "2023+",
  live: "Now",
  activity: "On-chain",
  nft: "NFT",
};

export function Checker() {
  const [wallet, setWallet] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WalletCheckResult | null>(null);
  const [doneTasks, setDoneTasks] = useState<Record<string, boolean>>({});
  const [sameWallet, setSameWallet] = useState(false);
  const [lockError, setLockError] = useState("");

  const enabledTasks = useMemo(() => TASKS.filter((t) => t.enabled), []);
  const disabledTasks = useMemo(() => TASKS.filter((t) => !t.enabled), []);

  const requiredTasksReady = enabledTasks
    .filter((t) => t.required)
    .every((t) => doneTasks[t.id]);

  const requiredReady = requiredTasksReady && sameWallet;

  function resetToForm() {
    setPhase("form");
    setResult(null);
    setError("");
    setInvalid(false);
    setSameWallet(false);
    setLockError("");
  }

  async function runCheck() {
    if (!requiredTasksReady) {
      setError("Complete the required tasks first.");
      return;
    }
    const address = wallet.trim();
    if (!isSolanaAddress(address)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setError("");
    setPhase("checking");
    try {
      const data = await checkWallet({ data: { address } });
      setResult(data);
      setWallet(data.wallet);
      setPhase("result");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not read that wallet on Solana right now.",
      );
      setPhase("form");
    }
  }

  async function submit() {
    if (!result) return;
    if (!requiredReady) {
      setLockError("Confirm this is the same wallet you just checked.");
      return;
    }
    const existing = getLockIn(result.wallet);
    if (existing) {
      setPhase("done");
      return;
    }
    setLockError("");
    setPhase("submitting");
    try {
      await submitAllocation({
        data: { wallet: result.wallet, allocation: result.allocation },
      });
      saveLockIn({
        wallet: result.wallet,
        score: result.score,
        allocation: result.allocation,
        breakdown: result.breakdown,
        lockedAt: new Date().toISOString(),
        tasks: { ...doneTasks, sameWallet: true },
      });
      setPhase("done");
    } catch (err) {
      setLockError(
        err instanceof Error ? err.message : "Submit failed. Try again.",
      );
      setPhase("lockin");
    }
  }

  function shareOnX() {
    if (!result) return;
    const text = [
      `Checked my Solana wallet on ${BRAND.name}.`,
      ``,
      `Score: ${result.score}`,
      `Allocation: ${formatInt(result.allocation)} $${BRAND.token}`,
      ``,
      `Check yours: ${window.location.origin}`,
    ].join("\n");
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const alreadyLocked = result ? getLockIn(result.wallet) : null;

  return (
    <div className="relative min-h-dvh overflow-x-hidden text-fg">
      <Starfield />

      <main className="relative z-10 mx-auto w-full max-w-2xl px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <div className="mb-8 flex items-center justify-between gap-3">
          <nav className="flex items-center gap-4 text-xs font-medium text-muted">
            <a href="#project" className="transition-colors hover:text-fg">
              Project
            </a>
            <a href="#token" className="transition-colors hover:text-fg">
              Token
            </a>
          </nav>
          <a
            href={BRAND.x}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-fg px-3 py-2 text-xs font-medium text-ink transition-opacity hover:opacity-90"
          >
            <XIcon className="size-3.5" />
            Follow
          </a>
        </div>

        <header className="text-left">
          <div className="flex items-center gap-2 text-fg">
            <LoopMark className={phase === "form" ? "size-6" : "size-5"} />
            <p className="text-xs font-medium tracking-[0.18em] text-muted">
              {BRAND.name}
            </p>
          </div>
          {phase === "form" ? (
            <>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
                Wallet check
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted">
                Paste a Solana address. Every valid check returns live balances
                and an allocation. Submit sends only the wallet and that number.
              </p>
            </>
          ) : (
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-fg">
              Wallet check
            </h1>
          )}
        </header>

        <section className="mt-8">
          {phase === "form" && (
            <div className="panel rounded-2xl bg-bg-elevated p-5 sm:p-6">
              <p className="text-xs font-medium text-muted">1 · Tasks</p>
              <p className="mt-1 mb-4 text-sm text-fg">
                Complete the required tasks below, then paste a wallet.
              </p>

              <TaskList
                enabledTasks={enabledTasks}
                disabledTasks={disabledTasks}
                doneTasks={doneTasks}
                onToggle={(id) => {
                  setDoneTasks((prev) => ({ ...prev, [id]: !prev[id] }));
                  setError("");
                }}
              />

              <div
                className={cn(
                  "mt-6 border-t border-fg/10 pt-5",
                  !requiredTasksReady && "opacity-45",
                )}
              >
                <p className="text-xs font-medium text-muted">2 · Wallet</p>
                <label htmlFor="wallet" className="mt-1 mb-2 block text-sm text-fg">
                  Solana address
                </label>
                <input
                  id="wallet"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={!requiredTasksReady}
                  value={wallet}
                  onChange={(e) => {
                    setWallet(e.target.value);
                    setInvalid(false);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runCheck();
                  }}
                  placeholder={
                    requiredTasksReady
                      ? "Paste a Solana wallet"
                      : "Complete tasks to unlock"
                  }
                  className={cn(
                    "w-full min-h-12 rounded-lg bg-bg px-3 py-3 font-mono text-sm text-fg outline-none placeholder:font-sans placeholder:text-faint shadow-[0_0_0_1px_rgb(244_244_245_/_0.12)] focus:shadow-[0_0_0_1px_rgb(244_244_245_/_0.4)] disabled:cursor-not-allowed",
                    invalid && "shadow-[0_0_0_1px_rgb(248_113_113_/_0.7)]",
                  )}
                />

                {invalid && (
                  <p className="mt-3 text-xs text-danger">
                    Invalid Solana address. Paste only — no seed, no signature.
                  </p>
                )}
                {error && !invalid && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-danger">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void runCheck()}
                  disabled={!requiredTasksReady}
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Check wallet
                  <ArrowRight className="size-4" />
                </button>
              </div>

              <p className="mt-4 text-center text-[11px] leading-5 text-faint">
                Read-only. No seed. No approve. No spend.
              </p>
            </div>
          )}

          {phase === "checking" && (
            <div className="panel flex flex-col items-center rounded-2xl bg-bg-elevated px-6 py-14 text-center">
              <div className="size-8 rounded-full border border-fg/20 border-t-fg animate-spin" />
              <h2 className="mt-5 text-lg font-semibold text-fg">
                Reading Solana
              </h2>
              <p className="mt-2 max-w-sm text-sm text-muted">
                Live SOL, meme-token balances, and history back through 2021
                (Serum, Raydium, Jupiter).
              </p>
            </div>
          )}

          {phase === "result" && result && (
            <ResultCard
              result={result}
              onNext={() => {
                setLockError("");
                setPhase("lockin");
              }}
              onReset={resetToForm}
              onShare={shareOnX}
            />
          )}

          {(phase === "lockin" || phase === "submitting") && result && (
            <div className="panel rounded-2xl bg-bg-elevated p-5 sm:p-6">
              <p className="text-xs font-medium text-muted">Submit</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
                Send this wallet
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Stays on this page. Only the address and allocation go to
                SOLLOOP.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-surface px-4 py-3 shadow-[0_0_0_1px_rgb(244_244_245_/_0.08)]">
                  <p className="text-xs text-faint">Wallet</p>
                  <p className="mt-1 font-mono text-sm text-fg">
                    {shortenAddress(result.wallet, 8, 6)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface px-4 py-3 shadow-[0_0_0_1px_rgb(244_244_245_/_0.08)]">
                  <p className="text-xs text-faint">Allocation</p>
                  <p className="mt-1 text-xl font-semibold text-fg tabular-nums">
                    {formatInt(result.allocation)}{" "}
                    <span className="text-sm text-muted">{BRAND.token}</span>
                  </p>
                </div>
              </div>

              {alreadyLocked && (
                <p className="mt-4 text-xs text-ok">
                  Already submitted at {formatInt(alreadyLocked.allocation)}{" "}
                  {BRAND.token}. First submit wins.
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  setSameWallet((v) => !v);
                  setLockError("");
                }}
                className={cn(
                  "mt-5 flex min-h-12 w-full items-center gap-3 rounded-lg px-4 py-3 text-left shadow-[0_0_0_1px_rgb(244_244_245_/_0.1)]",
                  sameWallet && "bg-ok/10 shadow-[0_0_0_1px_rgb(74_222_128_/_0.35)]",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    sameWallet ? "bg-ok text-ink" : "bg-surface text-muted",
                  )}
                >
                  {sameWallet ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : (
                    <span className="size-2 rounded-full bg-faint" />
                  )}
                </span>
                <span className="flex-1 text-sm text-fg">
                  This is the same wallet I checked (
                  {shortenAddress(result.wallet)})
                </span>
              </button>

              {lockError && (
                <p className="mt-3 text-xs text-danger">{lockError}</p>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setPhase("result")}
                  disabled={phase === "submitting"}
                  className="min-h-12 flex-1 rounded-md px-6 text-sm font-medium text-fg shadow-[0_0_0_1px_rgb(244_244_245_/_0.16)]"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={
                    phase === "submitting" ||
                    (!requiredReady && !alreadyLocked)
                  }
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-fg px-6 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {phase === "submitting"
                    ? "Submitting…"
                    : alreadyLocked
                      ? "View submission"
                      : "Submit wallet"}
                </button>
              </div>
            </div>
          )}

          {phase === "done" && result && (
            <div className="panel rounded-2xl bg-bg-elevated px-5 py-10 text-center sm:px-8">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-ok/10 text-ok">
                <Check className="size-6" strokeWidth={2.5} />
              </div>
              <h2 className="mt-5 text-2xl font-semibold text-fg">Submitted</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
                {shortenAddress(result.wallet, 8, 6)} ·{" "}
                <span className="text-fg">
                  {formatInt(alreadyLocked?.allocation ?? result.allocation)}{" "}
                  {BRAND.token}
                </span>
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={resetToForm}
                  className="min-h-12 rounded-md px-6 text-sm font-medium text-fg shadow-[0_0_0_1px_rgb(244_244_245_/_0.16)]"
                >
                  Check another wallet
                </button>
                <a
                  href={BRAND.x}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-fg px-6 text-sm font-medium text-ink"
                >
                  <XIcon className="size-3.5" />
                  Follow {BRAND.xHandle}
                </a>
              </div>
            </div>
          )}
        </section>

        <ProjectAndToken />

        <footer className="mt-12 space-y-3 text-center">
          <p className="text-[11px] leading-5 text-faint">
            Read-only public RPC. Every valid wallet gets a participation
            allocation. Old wallets are dated from first on-chain activity and
            token accounts, not just the last few swaps. DEX covers Jupiter,
            Raydium, Serum, and Orca. Submit posts wallet + allocation only.
          </p>
          <div className="flex items-center justify-center gap-5 text-xs font-medium text-muted">
            <a
              href={BRAND.x}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-fg"
            >
              X
            </a>
            <a
              href={BRAND.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-fg"
            >
              Telegram
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function TaskList({
  enabledTasks,
  disabledTasks,
  doneTasks,
  onToggle,
}: {
  enabledTasks: Task[];
  disabledTasks: Task[];
  doneTasks: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {enabledTasks.map((task) => {
        const on = Boolean(doneTasks[task.id]);
        return (
          <li key={task.id} className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => onToggle(task.id)}
              className={cn(
                "flex min-h-12 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left shadow-[0_0_0_1px_rgb(244_244_245_/_0.1)]",
                on && "bg-ok/10 shadow-[0_0_0_1px_rgb(74_222_128_/_0.35)]",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full",
                  on ? "bg-ok text-ink" : "bg-surface text-muted",
                )}
              >
                {on ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : (
                  <span className="size-2 rounded-full bg-faint" />
                )}
              </span>
              <span className="flex-1 text-sm text-fg">{task.label}</span>
            </button>
            {task.url ? (
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${task.label}`}
                className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-muted shadow-[0_0_0_1px_rgb(244_244_245_/_0.1)] hover:text-fg"
              >
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </li>
        );
      })}
      {disabledTasks.map((task) => (
        <li
          key={task.id}
          className="flex min-h-12 items-center gap-3 rounded-lg px-4 py-3 opacity-50 shadow-[0_0_0_1px_rgb(244_244_245_/_0.06)]"
        >
          <Lock className="size-4 text-faint" />
          <span className="flex-1 text-sm text-muted">{task.label}</span>
          <span className="text-[11px] text-faint">{task.note ?? "Soon"}</span>
        </li>
      ))}
    </ul>
  );
}

function ResultCard({
  result,
  onNext,
  onReset,
  onShare,
}: {
  result: WalletCheckResult;
  onNext: () => void;
  onReset: () => void;
  onShare: () => void;
}) {
  const hits = result.breakdown.filter((row) => row.hit).length;

  return (
    <div className="panel overflow-hidden rounded-2xl bg-bg-elevated">
      <div className="border-b border-fg/10 px-5 py-8 text-center sm:px-8">
        <p className="text-xs font-medium text-muted">Your allocation</p>
        <p className="mt-1 font-display text-5xl font-semibold tracking-tight text-fg tabular-nums">
          {formatInt(result.allocation)}{" "}
          <span className="text-2xl text-muted">{BRAND.token}</span>
        </p>
        <p className="mt-5 text-xs font-medium text-muted">Score</p>
        <p className="mt-1 font-display text-2xl font-semibold text-fg tabular-nums">
          {result.score}
        </p>
        <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-2 text-left">
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="text-[10px] text-faint">SOL</p>
            <p className="mt-0.5 text-sm tabular-nums text-fg">
              {result.sol.toLocaleString("en-US", { maximumFractionDigits: 3 })}
            </p>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="text-[10px] text-faint">Txs</p>
            <p className="mt-0.5 text-sm tabular-nums text-fg">
              {result.txCount
                ? `${formatInt(result.txCount)}${result.txCount >= 1000 ? "+" : ""}`
                : "0"}
            </p>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="text-[10px] text-faint">First seen</p>
            <p className="mt-0.5 text-sm tabular-nums text-fg">
              {result.firstActivity
                ? new Date(result.firstActivity * 1000).toISOString().slice(0, 10)
                : "—"}
            </p>
          </div>
        </div>
        <p className="mx-auto mt-4 max-w-md text-xs leading-5 text-muted">
          {hits} of {result.breakdown.length} checks hit.{" "}
          {result.sigsScanned
            ? `${formatInt(result.sigsScanned)} signatures scanned`
            : "No signatures"}
          {result.scannedTo
            ? ` · back to ${new Date(result.scannedTo * 1000).toISOString().slice(0, 10)}`
            : ""}
          .
        </p>
        <p className="mt-2 font-mono text-[11px] text-faint">
          {shortenAddress(result.wallet, 8, 6)}
        </p>
      </div>

      <div className="px-4 py-5 sm:px-6">
        <p className="mb-3 text-xs font-medium text-muted">Breakdown</p>
        <ul className="space-y-2">
          {result.breakdown.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full",
                  row.unavailable
                    ? "bg-faint/20 text-faint"
                    : row.hit
                      ? "bg-fg text-ink"
                      : "bg-danger/15 text-danger",
                )}
              >
                {row.unavailable ? (
                  <span className="text-[10px] font-bold">—</span>
                ) : row.hit ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : (
                  <X className="size-3" strokeWidth={3} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm text-fg">{row.label}</span>
                  <span className="text-[11px] text-faint">
                    {KIND_LABEL[row.kind]}
                  </span>
                </div>
                <p className="truncate text-[11px] text-muted">{row.detail}</p>
              </div>
              <span className="text-xs text-muted tabular-nums">
                {row.hit ? `+${row.points}` : "0"}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onNext}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-fg px-6 text-sm font-medium text-ink"
          >
            Submit this wallet
            <ArrowRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={onReset}
            className="min-h-12 flex-1 rounded-md px-6 text-sm font-medium text-fg shadow-[0_0_0_1px_rgb(244_244_245_/_0.16)]"
          >
            Check another
          </button>
          <button
            type="button"
            onClick={onShare}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md px-6 text-sm font-medium text-fg shadow-[0_0_0_1px_rgb(244_244_245_/_0.16)]"
          >
            <XIcon className="size-3.5" />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
