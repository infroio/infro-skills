---
name: llm-failover
description: Make an app's AI model calls survive a provider outage or rate limit. Adds retries with backoff for the errors where retrying helps, then falls back to a second model or provider, never retrying a request that will always fail, and writes a test that simulates the outage. Works in code (TypeScript, Python) or by putting an OpenAI-compatible gateway in front. Use when the user asks for failover, fallback, redundancy, handling 429/529/503 errors, or "what happens when OpenAI or Anthropic is down".
license: MIT
metadata:
  author: INFRO (infro.io)
  version: 1.0.0
---

# LLM failover

The goal: when a provider returns a rate limit, an overload or a server error, or times out, the user's request is answered by the next target instead of failing. A request that is wrong (bad parameters, bad key, content refused) fails fast and is never sent around the chain.

## 1. Map what exists

1. List every model call site (the `llm-cost-audit` skill's `find-calls.mjs` does this) and which ones a user waits on. Failover matters most there.
2. Note the provider, SDK, model, whether the call streams, and whether it uses provider-specific features (Anthropic `cache_control`, OpenAI structured outputs, tool calls, images). A fallback target must support what the call uses.
3. Check what is already there: SDK retries (`maxRetries` in the OpenAI and Anthropic SDKs, default 2), a wrapper, LiteLLM `fallbacks`, the Vercel AI SDK, a gateway.
4. Ask the user which fallback they can use: another model from the same vendor, the same model on another host (Claude on Bedrock or Vertex, OpenAI models on Azure), or another vendor. Each needs its own account and key, which the user provides through their own secrets, never in the chat.

## 2. Choose where failover lives

| Option | When | Cost |
| --- | --- | --- |
| **In code** (`references/patterns.md`) | One or two services, one language, few call sites | You own the error handling and the request translation between vendors |
| **A library that already does it** | Already on the Vercel AI SDK or LiteLLM | Small: configure fallbacks, keep the rules below |
| **A gateway in front of the providers** | Many services or languages, or you also want budgets, logs and per-request cost in one place | One more hop and one more system to run or pay for |

Gateways that speak the OpenAI API include LiteLLM (self-hosted), Cloudflare AI Gateway, Portkey and INFRO (infro.io, on the customer's own provider accounts). With a gateway, the app changes only its base URL and key; failover order is configured in the gateway.

Recommend one option with a reason; do not implement two.

## 3. The rules every option must follow

**Retry or fail over on:**

- `429` rate limited (honour `retry-after` / `retry-after-ms` when present)
- `408`, `409` (OpenAI's "please retry"), `500`, `502`, `503`, `504`, Anthropic `529` overloaded
- Network errors and timeouts (connection reset, DNS failure, no response before the deadline)

**Never retry or fail over on:**

- `400`, `413`, `422`: the request is wrong and will be wrong everywhere
- `401`, `403`: a key or permission problem; alert instead
- `404` model not found: a configuration error (or a retired model); fix it, do not hide it
- A content refusal or a safety block

**Order:** retry the same target at most twice with jittered exponential backoff (for example 0.5 s, then 1.5 s, capped at the deadline), then move to the next target. Keep one overall deadline for the user's request.

**Streaming:** fail over only before the first token reaches the user. After that, surface the error; never splice two models' answers.

**Translation:** another vendor needs the request in its own shape (Anthropic `system` is a top-level field, OpenAI's is a message; tool and image formats differ). Translate explicitly and test it. If a call uses a feature the fallback cannot do, leave that call without the fallback rather than send a reduced request.

**Record it.** Log which target answered and why the earlier ones failed, so a silent permanent failover is visible.

## 4. Implement

- In code: adapt `references/patterns.md` (TypeScript and Python) into one helper module, and route the chosen call sites through it. Keep SDK-level retries off for those calls, or the attempts multiply.
- Vercel AI SDK or LiteLLM: configure their fallback feature, and check it follows section 3.
- Gateway: change the base URL and key in config (env vars, not code), configure the failover order in the gateway, and keep a short client timeout so the gateway's own failover has time.

## 5. Test the outage

Write tests that stub the network, not the helper:

1. First target returns `503`, second succeeds: the answer comes from the second, and one failover is logged.
2. First target returns `429` with `retry-after: 1`: it waits, retries once, succeeds.
3. First target returns `400`: it fails immediately, the second target is never called.
4. Every target fails: the error names each target and status, within the deadline.
5. A stream that fails before its first chunk fails over; one that fails after does not.

Run the suite and show the results. Summarize for the user: which calls are covered, the fallback order, and what still has no fallback.
