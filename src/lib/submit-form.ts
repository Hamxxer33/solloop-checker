import { createServerFn } from "@tanstack/react-start";
import { GOOGLE_FORM } from "@/lib/config";
import { isSolanaAddress } from "@/lib/address";

export const submitAllocation = createServerFn({ method: "POST" })
  .validator((data: { wallet: string; allocation: number }) => {
    const wallet = String(data?.wallet ?? "").trim();
    const allocation = Number(data?.allocation);
    if (!isSolanaAddress(wallet)) {
      throw new Error("Enter a valid Solana wallet address.");
    }
    if (!Number.isFinite(allocation) || allocation < 0) {
      throw new Error("Allocation is missing.");
    }
    return { wallet, allocation: Math.trunc(allocation) };
  })
  .handler(async ({ data }) => {
    const body = new URLSearchParams();
    body.set(GOOGLE_FORM.allocationEntry, String(data.allocation));
    body.set(GOOGLE_FORM.walletEntry, data.wallet);

    const res = await fetch(GOOGLE_FORM.action, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent":
          "Mozilla/5.0 (compatible; SOLLOOP-checker/1.0; +https://x.com/Solloop)",
      },
      body: body.toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status >= 400) {
      throw new Error("Could not submit this wallet. Try again.");
    }
    return { ok: true as const, wallet: data.wallet, allocation: data.allocation };
  });
