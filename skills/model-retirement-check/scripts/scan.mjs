#!/usr/bin/env node
// Finds AI model ids in a codebase that their vendor has shut down, is
// shutting down, or already silently routes to another model.
//
//   node scan.mjs [path] [--json] [--soon 60] [--today YYYY-MM-DD] [--no-docs] [--fail-on soon|shutdown|none]
//
// Zero dependencies, Node 18+. Reads ../data/retirements.json (copied from the
// vendors' own deprecation pages; the file says when). Never edits anything.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const root = argv.find((a, i) => !a.startsWith("--") && !["--soon", "--today", "--fail-on"].includes(argv[i - 1])) ?? ".";
const soonDays = Number(option("--soon", "60"));
const today = option("--today", new Date().toISOString().slice(0, 10));
const failOn = option("--fail-on", "soon");
const includeDocs = !flag("--no-docs");

const data = JSON.parse(readFileSync(fileURLToPath(new URL("../data/retirements.json", import.meta.url)), "utf8"));

// ---------------------------------------------------------------- files

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel",
  ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", "vendor", "target", "coverage", ".cache",
]);
const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "poetry.lock", "uv.lock", "Cargo.lock",
  "Gemfile.lock", "composer.lock", "go.sum",
]);
const CODE = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx", ".py", ".rb", ".go", ".java", ".kt", ".rs",
  ".php", ".cs", ".swift", ".dart", ".scala", ".ex", ".exs", ".vue", ".svelte", ".astro", ".sh", ".sql",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".tf", ".hcl", ".ipynb", ".txt",
]);
const DOCS = new Set([".md", ".mdx", ".rst", ".adoc"]);

function kindOf(file) {
  const name = basename(file);
  if (name.startsWith(".env") || name === "Dockerfile" || name.endsWith(".env")) return "code";
  const ext = extname(name).toLowerCase();
  if (CODE.has(ext)) return "code";
  if (DOCS.has(ext)) return "doc";
  return null;
}

function* walk(dir, top = true) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // A nested checkout (git worktree, submodule, vendored repo) is another codebase.
  if (!top && entries.some((e) => e.name === ".git")) return;
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full, false);
    } else if (e.isFile() && !SKIP_FILES.has(e.name)) {
      const kind = kindOf(full);
      if (!kind) continue;
      try {
        if (statSync(full).size > 1_000_000) continue;
      } catch {
        continue;
      }
      yield { path: full, kind };
    }
  }
}

// ---------------------------------------------------------------- matching

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byId = new Map();
for (const entry of data.models) for (const id of entry.ids) byId.set(id, entry);
const ids = [...byId.keys()].sort((a, b) => b.length - a.length);
// A model id is a whole token: not part of a longer id (gpt-5 inside gpt-5-mini)
// and not the tail of a cloud id (anthropic.claude-... on Bedrock runs its own schedule).
const ID_RE = new RegExp(`(?<![A-Za-z0-9_.\\-])(${ids.map(escape).join("|")})(?![A-Za-z0-9_\\-]|\\.[0-9])`, "g");
// Very short ids (o1, o3) are only counted inside quotes, or they match prose.
const SHORT = 4;

const DAY = 86_400_000;
const daysUntil = (day) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

function statusOf(entry) {
  if (entry.status === "retired") return { status: "shut-down", days: null };
  if (entry.status === "routing") return { status: "routing-now", days: null };
  const days = daysUntil(entry.shutdown);
  if (days <= 0) return { status: entry.behavior === "routes" ? "routing-now" : "shut-down", days };
  if (days <= soonDays) return { status: "soon", days };
  return { status: "later", days };
}

const findings = [];
const endpointFindings = [];
let scanned = 0;

for (const file of walk(root)) {
  if (file.kind === "doc" && !includeDocs) continue;
  let text;
  try {
    text = readFileSync(file.path, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue;
  scanned++;
  const rel = relative(root, file.path).split("\\").join("/");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 2000) return;
    const seen = new Set();
    for (const m of line.matchAll(ID_RE)) {
      const id = m[1];
      if (seen.has(id)) continue;
      if (id.length < SHORT) {
        const before = line[m.index - 1];
        const after = line[m.index + id.length];
        if (!(`"'\``.includes(before ?? "x") && `"'\``.includes(after ?? "x"))) continue;
      }
      seen.add(id);
      const entry = byId.get(id);
      findings.push({ id, file: rel, line: i + 1, kind: file.kind, text: line.trim().slice(0, 160), entry, ...statusOf(entry) });
    }
    for (const ep of data.endpoints ?? []) {
      for (const p of ep.patterns) {
        if (line.includes(p)) {
          endpointFindings.push({ pattern: p, file: rel, line: i + 1, kind: file.kind, shutdown: ep.shutdown, days: daysUntil(ep.shutdown), replacement: ep.replacement });
        }
      }
    }
  });
}

// ---------------------------------------------------------------- output

const ORDER = { "shut-down": 0, "routing-now": 1, soon: 2, later: 3 };
findings.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.days ?? -1e9) - (b.days ?? -1e9) || a.file.localeCompare(b.file) || a.line - b.line);

const code = findings.filter((f) => f.kind === "code");
const blocking = code.filter((f) => (failOn === "soon" ? ["shut-down", "routing-now", "soon"] : failOn === "shutdown" ? ["shut-down"] : []).includes(f.status));

if (flag("--json")) {
  console.log(JSON.stringify({
    checked: data.checked, today, soonDays, filesScanned: scanned,
    findings: findings.map(({ entry, ...f }) => ({ ...f, vendor: entry.vendor, shutdown: entry.shutdown, behavior: entry.behavior, replacement: entry.replacement, alias: !!entry.alias, note: entry.note ?? null, source: data.sources[entry.vendor] })),
    endpoints: endpointFindings,
  }, null, 2));
} else {
  const label = {
    "shut-down": "Already shut down (requests fail now)",
    "routing-now": "Vendor already answers with a different model",
    soon: `Shuts down within ${soonDays} days`,
    later: "Shuts down later",
  };
  const out = [];
  out.push(`# Model retirement check`, "");
  out.push(`Scanned ${scanned} files in \`${root}\` on ${today}. Vendor dates checked ${data.checked}: ${Object.values(data.sources).join(", ")}.`, "");
  if (!findings.length && !endpointFindings.length) out.push("No retired or retiring model ids found.");
  for (const status of Object.keys(label)) {
    const group = findings.filter((f) => f.status === status);
    if (!group.length) continue;
    out.push(`## ${label[status]} (${group.length})`, "");
    out.push("| Model | Where | Shutdown | Days left | After shutdown | Vendor's replacement |", "| --- | --- | --- | --- | --- | --- |");
    for (const f of group) {
      const e = f.entry;
      const where = `\`${f.file}:${f.line}\`${f.kind === "doc" ? " (docs)" : ""}`;
      const after = e.behavior === "routes" ? "routes to replacement" : "requests fail";
      const repl = e.replacement.length ? e.replacement.map((r) => `\`${r}\``).join(" or ") : "none named";
      out.push(`| \`${f.id}\`${e.alias ? " (alias)" : ""} | ${where} | ${e.shutdown ?? "retired"} | ${f.days ?? "-"} | ${after} | ${repl} |`);
    }
    const notes = [...new Set(group.map((f) => f.entry.note).filter(Boolean))];
    if (notes.length) out.push("", ...notes.map((n) => `- ${n}`));
    out.push("");
  }
  if (endpointFindings.length) {
    out.push(`## Retiring endpoints (${endpointFindings.length})`, "");
    out.push("| Endpoint | Where | Shutdown | Days left | Replacement |", "| --- | --- | --- | --- | --- |");
    for (const f of endpointFindings) out.push(`| \`${f.pattern}\` | \`${f.file}:${f.line}\` | ${f.shutdown} | ${f.days} | ${f.replacement} |`);
    out.push("");
  }
  out.push("A replacement is a different model: different answers, different price. Test it before switching.");
  out.push("Amazon Bedrock, Google Vertex AI, Azure OpenAI and resellers such as OpenRouter run their own schedules; this list covers the vendors' own APIs.");
  console.log(out.join("\n"));
}

process.exit(blocking.length ? 1 : 0);
