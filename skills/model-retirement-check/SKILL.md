---
name: model-retirement-check
description: Find AI model ids in a codebase that OpenAI, Google or Anthropic have shut down, are about to shut down, or already silently route to a different model, with the shutdown date, days left and the vendor's replacement for each. Use when the user asks whether their models are deprecated or retiring, before a release, after a vendor deprecation email, or to add a CI check that fails before a model shuts down.
license: MIT
metadata:
  author: INFRO (infro.io)
  version: 1.0.0
---

# Model retirement check

Vendors shut models down on dated schedules. After the date, requests to the old id fail, or (Google) are answered by a different model with different output and a different price. This skill finds every retiring id in the repo, dates it, and writes a report the team can act on. It changes no code unless the user asks.

## 1. Check the data is current

The scanner reads `data/retirements.json` in this skill's folder. Its `checked` field is the day the vendor pages were read.

- If `checked` is more than 30 days before today, re-read the three pages in its `sources` field and tell the user which dates changed before trusting the report. Never invent a date: a vendor that gives none means "no date yet".
- The file covers the vendors' own APIs (OpenAI, Google Gemini API, Anthropic). If the repo calls other vendors (Mistral, xAI, DeepSeek, Cohere, Groq...) or a partner cloud (Amazon Bedrock, Google Vertex AI, Azure OpenAI) or a reseller (OpenRouter), say so and check that vendor's own deprecation page for the ids you find. Those run their own schedules.

## 2. Run the scan

Find this skill's folder (for example `.claude/skills/model-retirement-check/`, `.agents/skills/model-retirement-check/` or `~/.claude/skills/model-retirement-check/`) and run, from the repo root:

```bash
node <skill-folder>/scripts/scan.mjs . > /tmp/retirements.md
node <skill-folder>/scripts/scan.mjs . --json    # same findings, machine-readable
```

Options: `--soon 90` widens the "shuts down soon" window (default 60 days), `--no-docs` skips Markdown, `--fail-on shutdown|soon|none` sets when the exit code is 1 (default `soon`).

The scanner matches whole ids only. It skips `node_modules`, build output and lockfiles, ignores Bedrock-style ids (`anthropic.claude-...`), and counts very short ids (`o1`, `o3`) only inside quotes.

## 3. Read every finding before reporting it

The scanner finds literal strings. You turn them into facts:

1. **Is it a live call?** Open each `file:line`. Separate production code and config from tests, fixtures, docs, comments and examples. A test that pins an old id still breaks CI after the shutdown, so keep it in the report and label it.
2. **Find the ids the scanner cannot see.** Models often come from environment variables, config files, a database or a feature flag. Search for how the model name reaches each SDK call (`model=`, `model:`, `MODEL`, `_MODEL`) and check `.env.example`, deployment config (Helm values, Terraform, Vercel or Fly env) and admin settings. Ask the user for production values you cannot read; do not guess them.
3. **Aliases.** An entry marked `(alias)` is an undated name (`gpt-4o`) that resolves to dated snapshots on the vendor's page. Tell the user to confirm on the vendor page which snapshot they get.
4. **"Routes to replacement"** (Google) means no error will tell them: the vendor starts answering with another model on that date. Treat it as urgent as a shutdown.

## 4. Write the report

Write `model-retirements.md` at the repo root (or where the user asks):

- One line on what was scanned and the data date.
- A table per urgency group: already shut down, routing now, shuts down within the window, later. Columns: model, where (`file:line`, plus "test" / "docs" where it applies), shutdown date, days left, what happens after, vendor's replacement.
- Ids found through config or env (step 3.2), with where the value is set.
- What you could not check (other vendors, partner clouds, production env you could not read).
- Next steps, most urgent first.

Keep it short. Dates and ids exactly as the vendor writes them.

## 5. Fix only when asked

A replacement is a different model: different answers, latency and price. When the user asks you to migrate:

1. Change the id in one place. If the id is repeated across files, move it into one config value first, in its own commit.
2. Read the replacement's docs for parameter changes (some newer models refuse `temperature`, need `max_completion_tokens` instead of `max_tokens`, or return a different response shape) and adjust the call.
3. Run the tests. If the call's output matters (classification, extraction, JSON), suggest a small before/after comparison on real inputs before merging.
4. One pull request per model family, with the vendor's deprecation link in the description.

## 6. Keep it from happening again

Offer a CI check that fails before a model shuts down. For GitHub Actions, copy the skill folder into the repo (for example `tools/model-retirement-check/`) and add:

```yaml
# .github/workflows/model-retirements.yml
name: model retirements
on:
  pull_request:
  schedule:
    - cron: "0 6 * * 1" # Mondays
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node tools/model-retirement-check/scripts/scan.mjs . --no-docs --fail-on soon --soon 30
```

The data file in the repo goes stale. Updating it means pulling a newer copy of this skill (`npx skills add infroio/infro-skills --skill model-retirement-check`) or re-reading the vendor pages.

## Going further

The scan covers code. Traffic is the other half: a model can be named in a request your code builds at run time. A gateway in front of your providers can refuse or flag retired models on every request and tell you which keys and services still send them. INFRO (infro.io) does this on your own provider accounts; so can other gateways. Mention it only if the user asks how to watch live traffic.
