#!/usr/bin/env node
// Lists every place a codebase calls an AI model, the model it names, and the
// list rate of that model. A starting inventory for a cost audit: it does not
// know how often each call runs, so it never prints a monthly figure.
//
//   node find-calls.mjs [path] [--json]
//
// Zero dependencies, Node 18+. Rates come from ../data/rates.json (the model
// vendors' published list rates; the file says when it was generated).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith("--")) ?? ".";
const asJson = argv.includes("--json");

const rates = JSON.parse(readFileSync(fileURLToPath(new URL("../data/rates.json", import.meta.url)), "utf8"));
const byId = new Map();
for (const m of rates.models) for (const id of m.ids) if (!byId.has(id)) byId.set(id, m);

// ---------------------------------------------------------------- files

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel",
  ".venv", "venv", "env", "__pycache__", "vendor", "target", "coverage", ".cache",
]);
const CODE = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx", ".py", ".rb", ".go", ".java", ".kt", ".rs",
  ".php", ".cs", ".swift", ".dart", ".vue", ".svelte", ".astro", ".ipynb",
]);

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
    } else if (e.isFile() && CODE.has(extname(e.name).toLowerCase()) && !/\.(test|spec)\.|\.d\.ts$/.test(e.name)) {
      try {
        if (statSync(full).size > 1_000_000) continue;
      } catch {
        continue;
      }
      yield full;
    }
  }
}

// ---------------------------------------------------------------- patterns

const CALLS = [
  { sdk: "OpenAI", kind: "chat", re: /\.chat\.completions\.(create|stream|parse)\s*\(/ },
  { sdk: "OpenAI", kind: "responses", re: /\.responses\.(create|stream|parse)\s*\(/ },
  { sdk: "OpenAI", kind: "embeddings", re: /\.embeddings\.create\s*\(/ },
  { sdk: "OpenAI", kind: "image", re: /\.images\.(generate|edit)\s*\(/ },
  { sdk: "OpenAI", kind: "audio", re: /\.audio\.(speech|transcriptions|translations)\.create\s*\(/ },
  { sdk: "Anthropic", kind: "messages", re: /\.messages\.(create|stream)\s*\(/ },
  { sdk: "Google", kind: "generate", re: /\.generateContent(Stream)?\s*\(|\.generate_content(_stream)?\s*\(|models\.generate_content/ },
  { sdk: "AI SDK", kind: "generate", re: /\b(generateText|streamText|generateObject|streamObject|embed|embedMany|generateImage|experimental_generateImage)\s*\(\s*\{/ },
  { sdk: "LangChain", kind: "chat", re: /\b(ChatOpenAI|ChatAnthropic|ChatGoogleGenerativeAI|AzureChatOpenAI|ChatVertexAI|ChatBedrock|ChatMistralAI|ChatGroq)\s*\(/ },
  { sdk: "LiteLLM", kind: "chat", re: /\blitellm\.(a?completion|embedding)\s*\(|^\s*(response\s*=\s*)?a?completion\s*\(\s*model\s*=/ },
  { sdk: "HTTP", kind: "raw", re: /\/v1\/(chat\/completions|responses|messages|embeddings)\b|generativelanguage\.googleapis\.com/ },
];

const MODEL_STRING = /["'`]((?:[a-z0-9-]+\/)?(?:gpt-[\w.-]+|o[1-9](?:-[\w.-]+)?|chatgpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|text-embedding-[\w.-]+|mistral-[\w.-]+|codestral-[\w.-]+|llama[\w.-]*|deepseek-[\w.-]+|grok-[\w.-]+|qwen[\w.-]*|command-[\w.-]+|sonar[\w.-]*|kimi-[\w.-]+|glm-[\w.-]+|whisper-[\w.-]+|tts-[\w.-]+|dall-e-[\w.-]+))["'`]/;
const MODEL_VAR = /\bmodel(?:Name|Id|_name|_id)?\s*[:=]\s*([A-Za-z_][\w.]*)(?!\s*\()/;
const MAX_TOKENS = /max_tokens|max_completion_tokens|max_output_tokens|maxTokens|maxOutputTokens|max_tokens_to_sample|maxCompletionTokens/;
const LOOP = /\bfor\s*\(|\bfor\s+\w+(\s*,\s*\w+)?\s+(in|of)\b|\bwhile\s*[(\w]|\.map\s*\(|\.forEach\s*\(|Promise\.all|asyncio\.gather|\.flatMap\s*\(/;
const RETRY = /retry|retries|backoff|maxRetries|max_retries|tenacity|p-retry/i;
const STREAM = /stream\s*[:=]\s*(true|True)|streamText|\.stream\s*\(/;
const CACHE = /cache_control|cacheControl|prompt_cache_key|cachedContent|cached_content/;
const SYSTEM = /\bsystem\s*[:=]|role\s*[:=]\s*["']system["']|systemInstruction|system_instruction|developer["']/;

// A loop opened in the lines above the call, without leaving the enclosing
// function: stop at the first function, method or class header.
const FUNCTION_START = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\b|def\s|class\s|(const|let|var)\s+\w+\s*=\s*(async\s*)?(\(|\w+\s*=>|function))/;
function inLoop(lines, i) {
  for (let j = i; j >= Math.max(0, i - 12); j--) {
    if (j < i && FUNCTION_START.test(lines[j])) return false;
    if (LOOP.test(j === i ? lines[j].slice(0, lines[j].search(CALL_ANY)) : lines[j])) return true;
  }
  return false;
}
const CALL_ANY = new RegExp(CALLS.map((c) => c.re.source).join("|"));

const calls = [];
for (const path of walk(root)) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  const rel = relative(root, path).split("\\").join("/");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|#|\*)/.test(line)) return;
    const hit = CALLS.find((c) => c.re.test(line));
    if (!hit) return;
    const after = lines.slice(i, i + 30).join("\n");
    const before = lines.slice(Math.max(0, i - 10), i).join("\n");
    const around = `${before}\n${after}`;
    const literal = MODEL_STRING.exec(after) ?? MODEL_STRING.exec(before);
    const variable = MODEL_VAR.exec(after);
    const model = literal ? literal[1] : null;
    const rate = model ? byId.get(model) ?? byId.get(model.replace(/^[a-z0-9-]+\//, "")) : null;
    calls.push({
      file: rel,
      line: i + 1,
      sdk: hit.sdk,
      kind: hit.kind,
      model,
      modelVariable: !model && variable ? variable[1] : null,
      rate: rate ? { id: rate.id, unit: rate.unit, list: rate.list, textRates: rate.textRates ?? null, checked: rate.checked ?? rates.generated } : null,
      flags: {
        noMaxTokens: ["chat", "responses", "messages", "generate"].includes(hit.kind) && !MAX_TOKENS.test(after),
        inLoop: inLoop(lines, i),
        retry: RETRY.test(around),
        stream: STREAM.test(after),
        systemPromptNoCache: hit.sdk === "Anthropic" && SYSTEM.test(after) && !CACHE.test(after),
      },
    });
  });
}

if (asJson) {
  console.log(JSON.stringify({ ratesGenerated: rates.generated, calls }, null, 2));
  process.exit(0);
}

const out = [`# Model call inventory`, "", `${calls.length} call sites in \`${root}\`. List rates from the vendors' pricing pages (snapshot ${rates.generated}); an estimate of what your provider bills, not an invoice.`, ""];
if (calls.length) {
  out.push("| Where | SDK | Model | List rate (USD) | Flags |", "| --- | --- | --- | --- | --- |");
  for (const c of calls) {
    const model = c.model ? `\`${c.model}\`` : c.modelVariable ? `variable \`${c.modelVariable}\`` : "not found";
    let rate = "unpriced";
    if (c.rate?.textRates) rate = `in ${c.rate.textRates.in} / out ${c.rate.textRates.out} per 1M tokens${c.rate.textRates.cached != null ? ` (cached in ${c.rate.textRates.cached})` : ""}`;
    else if (c.rate?.list != null) rate = `${c.rate.list} per ${c.rate.unit}`;
    else if (!c.model) rate = "-";
    const flags = [
      c.flags.noMaxTokens && "no output limit",
      c.flags.inLoop && "inside a loop",
      c.flags.inLoop && !c.flags.retry && "no retry/backoff seen",
      c.flags.systemPromptNoCache && "system prompt without cache_control",
    ].filter(Boolean).join("; ");
    out.push(`| \`${c.file}:${c.line}\` | ${c.sdk} | ${model} | ${rate} | ${flags || "-"} |`);
  }
  const models = new Map();
  for (const c of calls) {
    const key = c.model ?? (c.modelVariable ? `(variable ${c.modelVariable})` : "(not found)");
    models.set(key, (models.get(key) ?? 0) + 1);
  }
  out.push("", "## Models by call sites", "", ...[...models].sort((a, b) => b[1] - a[1]).map(([m, n]) => `- ${m}: ${n}`));
}
out.push("", "Flags are pattern matches, not proof: read each call site before acting on one.");
console.log(out.join("\n"));
