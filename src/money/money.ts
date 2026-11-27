/**
 * Money helpers. Roots sends amounts as integer minor units in JSON strings.
 * We never use floating point for money: everything goes through BigInt.
 */
import type { MinorUnits } from '../models/types';

/** "12.34" -> "1234". Rejects more than 2 decimals instead of silently rounding. */
export function usd(dollars: string): MinorUnits {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(dollars.trim());
  if (!m) throw new Error(`Not a valid USD amount: "${dollars}"`);
  const [, sign, whole, frac = ''] = m;
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return (sign ? -cents : cents).toString();
}

export const toBig = (minor: MinorUnits): bigint => {
  if (!/^-?\d+$/.test(minor)) throw new Error(`Not an integer minor-unit string: "${minor}"`);
  return BigInt(minor);
};
export const add = (...xs: MinorUnits[]): MinorUnits => xs.reduce((a, x) => a + toBig(x), 0n).toString();
export const sub = (a: MinorUnits, b: MinorUnits): MinorUnits => (toBig(a) - toBig(b)).toString();
export const neg = (a: MinorUnits): MinorUnits => (-toBig(a)).toString();

/** "125050" -> "$1,250.50" for readable assertion messages. */
export function format(minor: MinorUnits): string {
  const v = toBig(minor);
  const abs = v < 0n ? -v : v;
  const dollars = (abs / 100n).toLocaleString('en-US');
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${v < 0n ? '-' : ''}$${dollars}.${cents}`;
}
