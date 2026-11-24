#!/usr/bin/env node
// Estimated provider cost of a call pattern, at the vendor's list rate.
//
//   node estimate.mjs <model> --in <input tokens> --out <output tokens> [--cached <cached input tokens>] [--calls <calls per month>]
//   node estimate.mjs <model> --units <images|seconds|...> [--calls <per month>]
//
// Prints one call and, with --calls, a month. Unknown model or rate: prints
// "unpriced" and exits 3, never a zero.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const model = argv[0];
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : Number(argv[i + 1]);
};
if (!model || model.startsWith("--")) {
  console.error("usage: estimate.mjs <model> --in N --out N [--cached N] [--calls N]   |   estimate.mjs <model> --units N [--calls N]");
  process.exit(2);
}

const rates = JSON.parse(readFileSync(fileURLToPath(new URL("../data/rates.json", import.meta.url)), "utf8"));
const entry = rates.models.find((m) => m.ids.includes(model) || m.ids.includes(model.replace(/^[a-z0-9-]+\//, "")));
if (!entry) {
  console.log(`${model}: unpriced (not in the rate snapshot of ${rates.generated}). Look up the vendor's pricing page.`);
  process.exit(3);
}

const calls = opt("--calls");
const usd = (n) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));
let perCall;
let how;

if (entry.textRates && opt("--in") !== null) {
  const input = opt("--in");
  const output = opt("--out") ?? 0;
  const cached = Math.min(opt("--cached") ?? 0, input);
  const { in: rin, out: rout, cached: rcached } = entry.textRates;
  perCall = ((input - cached) * rin + cached * (rcached ?? rin) + output * rout) / 1e6;
  how = `${input} input (${cached} cached) + ${output} output tokens at $${rin} / $${rout}${rcached != null ? ` / cached $${rcached}` : ""} per 1M`;
} else if (opt("--units") !== null) {
  if (entry.list == null) {
    console.log(`${entry.id}: unpriced (the vendor publishes no per-${entry.unit} rate).`);
    process.exit(3);
  }
  perCall = opt("--units") * entry.list;
  how = `${opt("--units")} x $${entry.list} per ${entry.unit}`;
} else {
  console.error(entry.textRates ? "pass --in and --out token counts" : `pass --units (this model is priced per ${entry.unit})`);
  process.exit(2);
}

console.log(`${entry.name} (${entry.id})`);
console.log(`  per call: $${usd(perCall)}  [${how}]`);
if (calls !== null) console.log(`  ${calls} calls a month: $${usd(perCall * calls)}`);
console.log(`  List rate${entry.checked ? ` read ${entry.checked} from ${entry.source}` : ` (snapshot ${rates.generated})`}. An estimate: your provider's invoice is the figure that counts.`);
