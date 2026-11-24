# AI cost and reliability skills for Claude Code, Codex and Cursor

Five open-source `SKILL.md` workflows for teams that call AI models from their code. Each one ends in a report or a pull request: the models about to be shut down, what each call costs, a fallback when a provider is down, and a spend limit per developer for coding agents.

```bash
npx skills add infroio/infro-skills
```

Four of the five work with no account anywhere. The fifth sets up [INFRO](https://infro.io), the gateway we build.

## The skills

| Skill | What it ships | Example prompt |
| --- | --- | --- |
| [`model-retirement-check`](skills/model-retirement-check/SKILL.md) | Every model id in the repo that OpenAI, Google or Anthropic has shut down, is shutting down, or already routes to another model: file and line, shutdown date, days left, the vendor's replacement. A zero-dependency scanner you can run in CI. | *"Run `model-retirement-check` and tell me what breaks before January"* |
| [`llm-cost-audit`](skills/llm-cost-audit/SKILL.md) | Every model call in the codebase priced at the vendor's list rate, monthly estimates from your real volumes, and the changes that touch the most spend: output limits, prompt caching, smaller models, batching, duplicate calls. | *"Audit what our LLM calls cost and rank the fixes"* |
| [`llm-failover`](skills/llm-failover/SKILL.md) | Retries and a fallback provider for the errors where they help (429, 5xx, 529, timeouts), never for a request that will always fail, plus tests that simulate the outage. In code (TypeScript, Python) or through a gateway. | *"Add failover to Azure when OpenAI returns 429 or 503, with tests"* |
| [`coding-agent-spend-caps`](skills/coding-agent-spend-caps/SKILL.md) | One key and one spend limit per developer for Claude Code, Codex, OpenCode and the agent SDKs, with session and agent attribution and a managed-settings rollout. | *"Set up per-developer spend limits for our Claude Code and Codex usage"* |
| [`infro-setup`](skills/infro-setup/SKILL.md) | INFRO connected from your assistant: your own provider account, a gateway key, your app pointed at it, and a verified first request. No credential passes through the chat. | *"Set up INFRO for this app"* |

## Shutdowns in the next few months

From the vendors' own deprecation pages, read 24 November 2026. The scanner finds these in your code.

| Date | Vendor | Models | After the date |
| --- | --- | --- | --- |
| 30 Nov 2026 | Anthropic | `claude-sonnet-4-5-20250929`, `claude-sonnet-4-5` | requests fail |
| 1 Dec 2026 | OpenAI | `gpt-image-1.5`, `gpt-image-1-mini`, `chatgpt-image-latest` | requests fail |
| 1 Dec 2026 | Google | `gemini-2.5-pro`, `gemini-2.5-flash` | answered by a different model |
| 11 Dec 2026 | OpenAI | `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `o3`, `o3-pro` | requests fail |
| 18 Dec 2026 | Google | `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.1-flash-tts-preview` | requests fail |
| 6 Jan 2027 | OpenAI | `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` | requests fail |
| 14 Jan 2027 | OpenAI | GPT-4o, GPT-4o mini, GPT-4.1, GPT-4.1 mini snapshots | requests fail |
| 20 Jan 2027 | OpenAI | `gpt-realtime`, `gpt-audio` and their mini models | requests fail |
| 22 Jan 2027 | Anthropic | `claude-opus-4-5-20251101`, `claude-opus-4-5` | requests fail |

Full list with replacements: [`retirements.json`](skills/model-retirement-check/data/retirements.json). Amazon Bedrock, Google Vertex AI, Azure OpenAI and OpenRouter run their own schedules.

## Run the scanner without an agent

```bash
git clone https://github.com/infroio/infro-skills
node infro-skills/skills/model-retirement-check/scripts/scan.mjs path/to/your/repo
node infro-skills/skills/llm-cost-audit/scripts/find-calls.mjs path/to/your/repo
```

Node 18 or newer, no install. The scanner exits with 1 when a model in your code is shut down or shuts down within 60 days, so it works as a CI step ([example](skills/model-retirement-check/SKILL.md#6-keep-it-from-happening-again)).

## Chains that work well

1. **Before the holidays:** `model-retirement-check` → fix what shuts down in December → `llm-failover` on the calls users wait on.
2. **The bill went up:** `llm-cost-audit` → the top three changes → `coding-agent-spend-caps` if agent usage is part of it.
3. **One place to watch it:** `infro-setup` → spend limits and a second provider connection in INFRO.

## Install per agent

| Agent | Where skills live | Install |
| --- | --- | --- |
| Claude Code | `.claude/skills/` or `~/.claude/skills/` | `npx skills add infroio/infro-skills -a claude-code` |
| Claude Code, as a plugin (skills + INFRO MCP server) | managed by Claude Code | `/plugin install infro-skills --marketplace infroio/infro-skills` |
| Cursor | `.cursor/skills/` or `.agents/skills/` | `npx skills add infroio/infro-skills -a cursor` |
| Codex, OpenCode, Windsurf, Cline | `.agents/skills/` | `npx skills add infroio/infro-skills` |
| One skill only | | `npx skills add infroio/infro-skills --skill model-retirement-check` |

Each skill is a folder with a `SKILL.md` that follows the [Agent Skills specification](https://agentskills.io). The agent reads its name and description at startup and opens the rest when your prompt matches.

## About the data

- **Retirement dates** are copied from the vendors' deprecation pages, with the day they were read. A date the vendor has not published is not guessed. The skill tells the agent to re-read the pages when the file is more than 30 days old.
- **Rates** are the vendors' published list rates, from the model catalog INFRO keeps for cost estimates, each with the page and date it was read. They are estimates of what your provider bills; your invoice, a negotiated rate or batch pricing differ. A model without a published rate is "unpriced", never zero.

Found a wrong date or rate? Open an issue with the vendor's link.

## What leaves your machine

- **The scripts** (`scan.mjs`, `find-calls.mjs`, `estimate.mjs`) make no network requests. They read the files in the folder you point them at and print a report.
- **`model-retirement-check`** asks your agent to open the OpenAI, Google and Anthropic deprecation pages listed in `retirements.json` when the data is more than 30 days old. Nothing from your code is sent to them.
- **`infro-setup`**, and the `.mcp.json` file installed with the Claude Code plugin, connect your assistant to INFRO's MCP server at `https://mcp.infro.io/mcp`. Nothing is sent until you use it: the first call opens INFRO in your browser, where you sign in, choose an organization and allow the assistant. The tools it offers, and what each one can change, are listed at [infro.io/docs/mcp](https://infro.io/docs/mcp). An app you then point at INFRO sends its model requests through `https://api.infro.io`. Provider credentials and gateway key secrets are entered in the INFRO console, never in the chat.
- **`llm-failover`** and **`coding-agent-spend-caps`** are instructions for your agent; they send nothing anywhere.

## Who makes this

[INFRO](https://infro.io) is a BYOK AI control plane: one gateway in front of the AI provider accounts you already have, with routing and failover, spend limits enforced before the provider call, and estimated cost per request. You keep paying your providers directly; INFRO charges a flat subscription with 0% markup on model spend. These skills are free and MIT-licensed whether you use INFRO or not.

## License

MIT
