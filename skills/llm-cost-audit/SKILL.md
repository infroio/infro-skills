---
name: llm-cost-audit
description: Audit what a codebase spends on AI models. Finds every model call (OpenAI, Anthropic, Gemini, Vercel AI SDK, LangChain, LiteLLM, raw HTTP), prices it at the vendor's list rate, estimates monthly cost from real volumes, and lists the changes that cut the most spend (output limits, prompt caching, smaller models, batching, duplicate calls). Use when the user asks what their LLM usage costs, why the AI bill went up, or how to reduce it.
license: MIT
metadata:
  author: INFRO (infro.io)
  version: 1.0.0
---

# LLM cost audit

The output is `llm-cost-audit.md`: every model call site with its estimated monthly cost, ranked, and the fixes worth making, each with the cost it touches. Every figure is an estimate at the vendor's list rate. The user's provider invoice is the real number, and a negotiated rate, batch pricing or a regional price will differ.

## Rules

- **Never invent a volume.** Calls per month come from logs, analytics, a database count, the provider's usage dashboard, or the user. If you have none, ask. If the user cannot say, show cost per 1,000 calls instead of a monthly figure.
- **Unpriced is not zero.** A model missing from the rate file, or with no published rate, is "unpriced". Look up the vendor's pricing page if you can, and cite it.
- **No model swap without a check.** Suggesting a smaller model is fine. Switching one needs a comparison on real inputs, because quality is part of cost.
- **State assumptions in the report.** Token counts, volumes and cache hit rates you estimated are marked as estimates, with how you got them.

## 1. Inventory the calls

Find this skill's folder (for example `.claude/skills/llm-cost-audit/`) and run from the repo root:

```bash
node <skill-folder>/scripts/find-calls.mjs .
node <skill-folder>/scripts/find-calls.mjs . --json
```

It lists each call site with its SDK, the model it names, the model's list rate from `data/rates.json` (the vendors' published rates; the file's `generated` field and each entry's `checked` say when), and flags: no output limit, inside a loop, no retry or backoff seen, an Anthropic system prompt without `cache_control`.

The finder uses patterns. Then:

- Open every call site. Drop false positives, and add calls it missed: wrapper functions, a client built in one file and called in another, models chosen at run time from config, env or a database.
- Where the model is a variable, trace it to its value. Ask for production values you cannot read.
- Note the vendor even when the model id is generic (Azure deployments, OpenRouter `vendor/model` ids, a gateway route name).

## 2. Size each call

For each real call site, work out:

| Quantity | How |
| --- | --- |
| Input tokens | Prompt template + typical inserted content + chat history + tool definitions + retrieved documents. About 4 characters of English per token; use the vendor's token-counting endpoint for anything large. |
| Cached input tokens | The repeated prefix (system prompt, tool definitions, fixed documents) when caching is on: `cache_control` on Anthropic, automatic prefix caching on OpenAI and Gemini for long repeated prefixes. Zero if caching is off. |
| Output tokens | Typical answer length. The output limit is the ceiling, not the typical value. |
| Calls per month | From the sources in **Rules**. Multiply by the loop size for calls in a loop, and by the retry rate if retries are common. |

Then compute with the helper, which reads the same rate file:

```bash
node <skill-folder>/scripts/estimate.mjs claude-sonnet-5-5 --in 3000 --cached 2000 --out 500 --calls 100000
node <skill-folder>/scripts/estimate.mjs gpt-image-2.5-sunburst --units 1 --calls 2000
```

It prints per-call and monthly cost and exits 3 with "unpriced" when it has no rate.

## 3. Find what to change

Check each call site for these, biggest spend first:

1. **A large model on a small task.** Classification, routing, extraction into a fixed schema and short rewrites often run well on a vendor's small model. Estimate both, and propose an evaluation on 50 to 200 real inputs before switching.
2. **No output limit.** Without `max_tokens` / `max_output_tokens` / `maxOutputTokens`, a runaway answer is billed in full. Set a limit a little above the longest legitimate answer.
3. **A repeated prefix without caching.** Large system prompts, tool lists or fixed documents sent on every call. Put static content first and dynamic content last; on Anthropic add `cache_control` breakpoints. Estimate with `--cached`.
4. **Calls in loops.** One call per item where one call for many items would do, or work that is not urgent: the vendors' batch APIs bill non-urgent work at a lower rate (check the vendor's current batch pricing).
5. **Duplicate work.** The same input sent twice (re-renders, retries without idempotency, embeddings recomputed for unchanged text). Cache by a hash of the input.
6. **Retries that multiply spend.** Retrying on a `400` repeats a request that will always fail; retrying without backoff during an outage turns one call into many.
7. **Context that grows.** Chat history or agent transcripts resent in full on every turn. Trim, summarize, or window.
8. **Retiring models.** A model about to be shut down will force a change anyway. The `model-retirement-check` skill lists them.

## 4. Write the report

`llm-cost-audit.md`:

- Summary: total estimated monthly spend at list rates, the three biggest call sites, the three changes that touch the most spend.
- Table, ranked by monthly estimate: call site, purpose, model, input / cached / output tokens, calls per month (and its source), estimated monthly cost, flags.
- Changes, each with the call sites, the spend it touches, the estimated cost after, what has to be verified first, and the effort.
- Assumptions and gaps: unpriced models, volumes the user supplied, calls you could not trace.
- One line: figures are estimates at vendor list rates on the snapshot date; the provider invoice is authoritative.

Do not make the changes unless the user asks. When they do, one pull request per change, with the before and after estimate in its description.

## Going further

A static audit is a snapshot. To see real cost per request, per feature and per customer as traffic happens, the calls have to be measured where they run: by logging token usage from each response, or by putting a gateway in front of the providers that records estimated cost per request. INFRO (infro.io) does this on the customer's own provider accounts; LiteLLM, Helicone and others can too. Mention it only if the user asks how to keep watching costs.
