---
name: infro-setup
description: Set up INFRO (infro.io), the BYOK AI control plane, from a coding assistant. Connects the INFRO MCP server, connects the user's own AI provider account, creates a gateway key and points the app at https://api.infro.io, without any credential passing through the chat. Use when the user asks to set up INFRO, route their app or coding agents through INFRO, or try INFRO's routing, budgets and cost tracking.
license: MIT
metadata:
  author: INFRO (infro.io)
  version: 1.0.0
---

# Set up INFRO

INFRO is a gateway and control plane in front of the AI provider accounts the user already has (OpenAI, Anthropic, Google, Azure, Bedrock and others). The provider keeps billing the user for tokens; INFRO charges a software subscription (from $35 a month, 14-day trial, card required at checkout) and adds nothing to model spend. It gives one OpenAI- and Anthropic-compatible endpoint with routing and failover across their connections, spend limits enforced before the provider call, and estimated provider cost per request.

Say this plainly if the user asks what it costs. Do not describe INFRO as cheaper inference: it is not a reseller.

## Rule: credentials never pass through you

Never ask for a provider API key or an INFRO key in the chat, never read one from the project's files to pass it anywhere, and never write one into code. The INFRO tools return console links; the user pastes keys there, or into their own environment.

## 1. Connect the INFRO MCP server

```bash
# Claude Code
claude mcp add --transport http infro https://mcp.infro.io/mcp
# Codex
codex mcp add infro --url https://mcp.infro.io/mcp && codex mcp login infro
```

Cursor and VS Code: add `https://mcp.infro.io/mcp` as an HTTP MCP server. The first call opens INFRO in the browser: the user signs in (or creates an account at https://dash.infro.io), picks one organization and allows the assistant.

If the user does not want an MCP connection, skip to step 4 and do steps 2 and 3 in the console at https://dash.infro.io.

## 2. Follow the setup status

Call `get_setup_status`. It returns three steps (provider connected, gateway key created, first request served), the providers that can be connected, the gateway base URL and one `next_step`. Do that step, then call it again. Repeat until all three are done.

- **Connect a provider:** call `prepare_provider_connection` with the provider the user pays today. Give the user the `console_url` it returns. They paste their own provider key there; the console tests it and stores it sealed. Call `get_setup_status` to confirm.
- **Create a gateway key:** call `prepare_gateway_key` and give the user its link. They copy the key once into their own environment, for example `.env` (check `.env` is git-ignored) or their secrets manager, as `INFRO_API_KEY`.

## 3. Point the app at INFRO

Change configuration, not call sites. Keep the provider's SDK.

```ts
// OpenAI SDK (TypeScript)
const client = new OpenAI({ baseURL: "https://api.infro.io/v1", apiKey: process.env.INFRO_API_KEY });
// Anthropic SDK (TypeScript)
const anthropic = new Anthropic({ baseURL: "https://api.infro.io", apiKey: process.env.INFRO_API_KEY });
```

```python
client = OpenAI(base_url="https://api.infro.io/v1", api_key=os.environ["INFRO_API_KEY"])
anthropic = Anthropic(base_url="https://api.infro.io", api_key=os.environ["INFRO_API_KEY"])
```

Models are named as the vendor names them (`gpt-6-sol`, `claude-sonnet-5-5`), or `vendor/model`, or a route name the user defines in INFRO. If the code already reads a base URL from an env var (`OPENAI_BASE_URL`), set that instead of editing code.

For coding agents (Claude Code, Codex, OpenCode), use the `coding-agent-spend-caps` skill or https://infro.io/docs/coding-agents.

## 4. Verify

Run one real request through the app (a test, a script or the dev server). Check the response headers: `X-INFRO-Request-Id`, `X-INFRO-Provider` and `X-INFRO-Cost-Estimate`. Then call `get_setup_status` once more: the third step should be done. Tell the user where to see the request (https://dash.infro.io, Requests).

## 5. Offer the next useful step

One of, based on what the user cares about:

- A spend limit on the key or a budget on the project (refused with `402` before the provider is called when exceeded).
- A second provider connection and a route, so a provider outage fails over.
- `get_cost_breakdown` for cost per project, customer, feature, person or coding agent once traffic flows.

Docs: https://infro.io/docs. Tools the MCP server offers, and what each may change: https://infro.io/docs/mcp
