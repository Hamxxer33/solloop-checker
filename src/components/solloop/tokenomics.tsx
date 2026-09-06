import { BRAND, PROJECT, TOKENOMICS } from "@/lib/config";
import { formatInt } from "@/lib/utils";

const community = TOKENOMICS.slices.filter((s) => s.group === "community");
const remaining = TOKENOMICS.slices.find((s) => s.group === "unpublished");

export function ProjectAndToken() {
  return (
    <div className="mt-16 space-y-6">
      <section id="project" className="scroll-mt-6">
        <div className="panel rounded-2xl bg-bg-elevated p-5 sm:p-7">
          <p className="text-xs font-medium tracking-wide text-muted">Project</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">
            {PROJECT.headline}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{PROJECT.body}</p>
          <dl className="mt-6 grid gap-2 sm:grid-cols-3">
            {PROJECT.facts.map((fact) => (
              <div
                key={fact.label}
                className="rounded-lg bg-surface px-4 py-3 shadow-[0_0_0_1px_rgb(244_244_245_/_0.08)]"
              >
                <dt className="text-xs text-faint">{fact.label}</dt>
                <dd className="mt-1 text-sm font-medium text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="token" className="scroll-mt-6">
        <div className="panel rounded-2xl bg-bg-elevated p-5 sm:p-7">
          <p className="text-xs font-medium tracking-wide text-muted">Token</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">
            ${TOKENOMICS.symbol} supply
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{TOKENOMICS.note}</p>

          <div className="mt-6 rounded-xl bg-surface px-4 py-5 shadow-[0_0_0_1px_rgb(244_244_245_/_0.08)] sm:px-6">
            <p className="text-center text-xs text-muted">Total supply</p>
            <p className="mt-2 text-center font-display text-4xl font-semibold tracking-tight text-fg tabular-nums sm:text-5xl">
              {formatInt(TOKENOMICS.totalSupply)}
            </p>
            <p className="mt-2 text-center text-xs text-faint">
              {TOKENOMICS.supplyLabel} ${TOKENOMICS.symbol} · {TOKENOMICS.chain}
            </p>

            <div
              className="mt-5 flex h-2 overflow-hidden rounded-full bg-bg"
              role="img"
              aria-label="25 percent airdrop, 25 percent NFT, 50 percent remaining"
            >
              <span className="h-full w-1/4 bg-fg" />
              <span className="h-full w-1/4 bg-fg/50" />
              <span className="h-full w-1/2 bg-fg/15" />
            </div>
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {TOKENOMICS.slices.map((slice) => (
                <li
                  key={slice.id}
                  className={slice.id === "remaining" ? "text-right" : undefined}
                >
                  <p className="text-xs text-muted">
                    {slice.percent}% {slice.shortLabel}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-faint tabular-nums">
                    {formatInt(slice.amount)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-6 text-xs font-medium text-muted">
            Vesting · 50% airdrop + NFT
          </p>
          <p className="mt-1 mb-3 text-xs leading-5 text-faint">
            Only this half has a published schedule.
          </p>

          <ul className="space-y-2">
            {community.map((slice) => (
              <li key={slice.id}>
                <VestingCard slice={slice} />
              </li>
            ))}
            {remaining ? (
              <li className="rounded-lg bg-surface px-4 py-4 shadow-[0_0_0_1px_rgb(244_244_245_/_0.08)]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-muted">{remaining.label}</p>
                  <p className="text-sm font-medium text-fg tabular-nums">
                    {remaining.percent}%
                  </p>
                </div>
                <p className="mt-1 font-mono text-xs text-faint tabular-nums">
                  {formatInt(remaining.amount)} ${BRAND.token}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted">{remaining.detail}</p>
              </li>
            ) : null}
          </ul>
        </div>
      </section>
    </div>
  );
}

function VestingCard({
  slice,
}: {
  slice: (typeof TOKENOMICS.slices)[number];
}) {
  const vesting = slice.vesting;
  if (!vesting) return null;

  const tgeAmount = Math.trunc((slice.amount * vesting.tgePercent) / 100);
  const vestedAmount = slice.amount - tgeAmount;
  const monthly =
    vesting.durationMonths > 0
      ? Math.trunc(vestedAmount / vesting.durationMonths)
      : 0;

  return (
    <article className="rounded-lg bg-surface px-4 py-4 shadow-[0_0_0_1px_rgb(244_244_245_/_0.08)]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-fg">{slice.label}</p>
        <p className="text-sm font-medium text-fg tabular-nums">{slice.percent}%</p>
      </div>
      <p className="mt-1 font-mono text-xs text-faint tabular-nums">
        {formatInt(slice.amount)} ${BRAND.token}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">{vesting.summary}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Start" value={vesting.start} />
        <Stat label="At start" value={`${vesting.tgePercent}%`} hint={formatInt(tgeAmount)} />
        <Stat
          label="Cliff"
          value={vesting.cliffMonths === 0 ? "None" : `${vesting.cliffMonths} mo`}
        />
        <Stat
          label="Then"
          value={
            vesting.cadence === "at-sale"
              ? `${vesting.durationMonths} mo linear`
              : `${vesting.durationMonths} mo monthly`
          }
          hint={monthly > 0 ? `${formatInt(monthly)} / mo` : undefined}
        />
      </dl>

      <div className="mt-3">
        <div className="flex h-1 overflow-hidden rounded-full bg-bg">
          <span className="h-full bg-fg" style={{ width: `${vesting.tgePercent}%` }} />
          <span
            className="h-full bg-fg/30"
            style={{ width: `${100 - vesting.tgePercent}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
          <span>
            {vesting.start} · {vesting.tgePercent}%
          </span>
          <span>+{vesting.durationMonths} mo · 100%</span>
        </div>
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md bg-bg px-2.5 py-2 shadow-[0_0_0_1px_rgb(244_244_245_/_0.06)]">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium text-fg">{value}</dd>
      {hint ? (
        <p className="font-mono text-[10px] text-faint tabular-nums">{hint}</p>
      ) : null}
    </div>
  );
}
