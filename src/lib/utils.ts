import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatInt(n: number): string {
  return Math.trunc(n).toLocaleString("en-US");
}

export function shortenAddress(address: string, left = 6, right = 4): string {
  if (address.length <= left + right + 1) return address;
  return `${address.slice(0, left)}…${address.slice(-right)}`;
}
