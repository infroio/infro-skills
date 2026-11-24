#!/usr/bin/env node
// Runs the skills' scripts against test/fixtures/sample-app and checks what
// they find. `node test/run.mjs`; exits 1 on the first failed check.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = join(here, "..");
const app = join(here, "fixtures", "sample-app");
const skills = join(repo, "skills");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`);
  if (!ok) failed++;
};

function run(script, args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }) };
  } catch (err) {
    return { code: err.status, out: err.stdout };
  }
}

// ------------------------------------------------------------ every SKILL.md

for (const dir of readdirSync(skills)) {
  const text = readFileSync(join(skills, dir, "SKILL.md"), "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const name = front && /^name: (.+)$/m.exec(front[1])?.[1];
  const description = front && /^description: (.+)$/m.exec(front[1])?.[1];
  check(`${dir}: frontmatter name matches folder`, name === dir, `name: ${name}`);
  check(`${dir}: description present, under 1024 characters`, !!description && description.length <= 1024, `length ${description?.length}`);
}

// ------------------------------------------------------------ retirement scan

const scan = join(skills, "model-retirement-check", "scripts", "scan.mjs");
const r = run(scan, [app, "--json", "--today", "2026-11-24"]);
const report = JSON.parse(r.out);
const found = (id, file) => report.findings.some((f) => f.id === id && (!file || f.file === file));

check("scan exits 1 when something shuts down soon", r.code === 1, `exit ${r.code}`);
check("finds claude-sonnet-4-5-20250929 (30 Nov)", found("claude-sonnet-4-5-20250929", "src/summarize.py"));
check("finds gpt-image-1.5 (1 Dec)", found("gpt-image-1.5", "src/images.ts"));
check("finds gemini-2.5-flash as routing", report.findings.some((f) => f.id === "gemini-2.5-flash" && f.behavior === "routes"));
check("finds quoted o3 in .env.example", found("o3", ".env.example"));
check("finds gpt-4o alias", report.findings.some((f) => f.id === "gpt-4o" && f.alias));
check("finds the audio translations endpoint", report.endpoints.some((e) => e.pattern === "/v1/audio/translations"));
check("labels the README mention as docs", report.findings.some((f) => f.id === "gpt-4" && f.kind === "doc"));
check("ignores gpt-5.5 (not retiring)", !found("gpt-5.5") && !found("gpt-5"), JSON.stringify(report.findings.filter((f) => f.id.startsWith("gpt-5"))));
check("ignores the Bedrock id", !report.findings.some((f) => f.file === "src/bedrock.ts"));
check("ignores node_modules", !report.findings.some((f) => f.file.includes("node_modules")));

const noDocs = JSON.parse(run(scan, [app, "--json", "--no-docs", "--today", "2026-11-24"]).out);
check("--no-docs skips Markdown", !noDocs.findings.some((f) => f.kind === "doc"));

const early = run(scan, [app, "--today", "2026-01-01", "--soon", "30", "--fail-on", "shutdown"]);
check("exit 0 when nothing is shut down yet and --fail-on shutdown", early.code === 0, `exit ${early.code}`);

// ------------------------------------------------------------ call inventory

const finder = join(skills, "llm-cost-audit", "scripts", "find-calls.mjs");
const inv = JSON.parse(run(finder, [app, "--json"]).out);
const call = (file) => inv.calls.find((c) => c.file === file);

check("finds 6 call sites", inv.calls.length === 6, `found ${inv.calls.length}`);
check("OpenAI call in a loop is flagged", call("src/chat.ts")?.flags.inLoop === true);
check("call after the loop's function is not flagged", inv.calls.find((c) => c.file === "src/chat.ts" && c.line === 15)?.flags.inLoop === false);
check("Gemini call without a limit is flagged", call("src/gemini.ts")?.flags.noMaxTokens === true);
check("AI SDK maxOutputTokens counts as a limit", call("src/ai-sdk.ts")?.flags.noMaxTokens === false);
check("Anthropic system prompt without cache_control is flagged", call("src/summarize.py")?.flags.systemPromptNoCache === true);
check("gpt-6-sol is priced", call("src/ai-sdk.ts")?.rate?.textRates?.in > 0);
check("an unknown model stays unpriced", call("src/summarize.py")?.rate === null);

// ------------------------------------------------------------ estimate

const estimate = join(skills, "llm-cost-audit", "scripts", "estimate.mjs");
const e = run(estimate, ["gpt-6-sol", "--in", "1000000", "--out", "0"]);
check("estimate: 1M input tokens of gpt-6-sol = its input rate", /per call: \$2\.00/.test(e.out), e.out);
check("estimate: unknown model exits 3, unpriced", run(estimate, ["no-such-model", "--in", "1", "--out", "1"]).code === 3);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
