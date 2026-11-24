---
name: coding-agent-spend-caps
description: See and cap what each developer's coding agents (Claude Code, Codex, OpenCode, Copilot CLI, the Claude and OpenAI agent SDKs) spend on API usage. Sets up one key and one spend limit per person, session and agent attribution, and a rollout through managed settings, either with the AI vendors' own console controls or through an OpenAI- and Anthropic-compatible gateway. Use when the user asks how much Claude Code or Codex costs per developer, wants per-person budgets for coding agents, or got a surprising API bill from agent usage.
license: MIT
metadata:
  author: INFRO (infro.io)
  version: 1.0.0
---

# Coding agent spend caps

Coding agents on API keys spend per token, and one long session can cost more than a month of a person's other usage. The fix is the same everywhere: every developer (or every agent) gets their own key with its own limit, and every request says which person, agent and session it belongs to.

This applies to API-key usage. Seat plans (Claude Team or Enterprise seats, ChatGPT Business, Cursor's own plans) are billed by those products and controlled in their admin consoles; say so if that is what the team uses.

## 1. Find out what the team runs

Ask, or read from the repo and onboarding docs:

- Which agents: Claude Code, Codex CLI, OpenCode, Copilot CLI, Cursor with its own API key, or agents built on the Claude Agent SDK or OpenAI Agents SDK.
- Which provider accounts pay for them, and whether everyone shares one key today.
- How many developers, and who should see the numbers (each developer, team leads, finance).
- Whether a hard stop is wanted, or only alerts.

## 2. Choose the control point

**A. The vendors' own consoles.** Anthropic and OpenAI let an organization split usage into workspaces or projects with their own keys, usage views and limits. Read the vendor's current docs for what is enforced and what only alerts before you recommend it, and state that to the user. It works without new software. Its limits: one vendor per console, the granularity the vendor offers, and no per-session view.

**B. A gateway in front of the providers.** The agents keep using the provider accounts the company already has; they reach them through a gateway that issues one key per developer, enforces each key's limit before the provider is called, and records cost per request with person, agent and session. One view across vendors. Options include LiteLLM (self-hosted, virtual keys with budgets) and INFRO (infro.io, hosted, on your own provider accounts). The snippets below use placeholders: `<GATEWAY_URL>` and `<DEVELOPER_KEY>`.

Recommend one, with the reason.

## 3. One key per developer

- Create one key per developer (or per developer and agent if they want them apart). Name it after the person.
- Set a monthly limit per key. A sensible start: last month's real usage for that person plus headroom, or a flat amount the team agrees. Decide what happens at the limit (refuse new requests, or alert a lead first).
- Developers keep the key in their own environment or OS keychain. Never commit it, never paste it into the chat.

## 4. Point each agent at its key

**Claude Code** (and the Claude Agent SDK, which reads the same variables):

```bash
export ANTHROPIC_BASE_URL="<GATEWAY_URL>"      # omit for option A
export ANTHROPIC_AUTH_TOKEN="<DEVELOPER_KEY>"  # sent as Authorization: Bearer
# optional attribution, newline-separated "Name: Value" pairs your gateway reads
export ANTHROPIC_CUSTOM_HEADERS="X-Workflow: claude-code"
```

Through a third-party base URL, Claude Code turns MCP tool search off unless `ENABLE_TOOL_SEARCH=true`; set it only if the gateway forwards Anthropic's request body unchanged, as its docs should say.

**Codex** (`~/.codex/config.toml`):

```toml
model_provider = "company"

[model_providers.company]
name = "Company gateway"
base_url = "<GATEWAY_URL>/v1"
env_key = "COMPANY_AI_KEY"   # the developer's key, from their environment
wire_api = "responses"
```

**OpenCode, Copilot CLI, Cursor**: each has a provider or base-URL setting; follow the gateway's or the vendor's page for that tool. Cursor's included models run through Cursor's own servers and are billed by Cursor; only requests made with your own API key are covered here.

**Agent SDKs**: set the client's base URL and key (`new Anthropic({ baseURL, apiKey })`, `OpenAI(base_url=..., api_key=...)`) from environment variables.

## 5. Attribute sessions and agents

Per-key limits answer "who". To answer "which session or task cost that much":

- Claude Code sends its session id (`x-claude-code-session-id`) and Codex its own; a gateway that recognizes them groups requests by session without setup.
- Otherwise send headers the gateway documents (session id, agent name, team or repo tags) through `ANTHROPIC_CUSTOM_HEADERS` or Codex's `http_headers`.
- Prefer labels set on the key (team, cost centre) over headers a developer can change.

## 6. Roll it out

- Claude Code reads an `env` block from managed settings, which admins can deploy to every machine; put the base URL and attribution there and leave only the key per person.
- Ship a one-page `docs/ai-agents.md` in the repo: which agents are allowed, how to get a key, the limit, who to ask for more, and what is logged.
- Revoke the old shared key once everyone has moved, after checking its usage has stopped.

## 7. Report back

Tell the user what was set up, per agent; who has a key and what limit; where spend per person, agent and session can be seen; and what is not covered (seat plans, Cursor's included models, anything still on a shared key).

## INFRO specifics

If the user chose INFRO: `<GATEWAY_URL>` is `https://api.infro.io`, keys look like `sk_infro_...`, each key can carry a spend limit and labels, and the request log and Summary show cost per person and per coding agent. Setup of providers and keys can be done from the assistant with the `infro-setup` skill. Full recipes per agent: https://infro.io/docs/coding-agents
