/** Server-only. Set SOLSCAN_API_KEY on Vercel — never expose this to the client. */
export const SOLSCAN_API_KEY = (
  typeof process !== "undefined" ? process.env.SOLSCAN_API_KEY : ""
)?.trim() ?? "";
