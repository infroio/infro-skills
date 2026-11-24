# Failover patterns

Starting points to adapt, not a library. Both versions call OpenAI-compatible
chat endpoints, which covers OpenAI, Azure OpenAI (with its own URL and
`api-key` header), most hosts of open models, and OpenAI-compatible gateways.
For a vendor with its own request shape (Anthropic Messages, Gemini), add a
`send` function per target that translates the request and response.

## TypeScript (Node 18+, fetch)

```ts
type Target = {
  name: string;          // for logs: "openai", "azure-eastus", ...
  url: string;           // full endpoint, e.g. https://api.openai.com/v1/chat/completions
  headers: Record<string, string>;
  model: string;
};

type Attempt = { target: string; status: number | "network" | "timeout"; ms: number };

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export class FailoverError extends Error {
  constructor(public attempts: Attempt[]) {
    super(`every target failed: ${attempts.map((a) => `${a.target} ${a.status}`).join(", ")}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | null {
  const ms = res.headers.get("retry-after-ms");
  if (ms) return Number(ms);
  const s = res.headers.get("retry-after");
  if (s && /^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  return null;
}

export async function chatWithFailover(
  targets: Target[],
  body: Record<string, unknown>,
  { deadlineMs = 30_000, retriesPerTarget = 2 } = {},
) {
  const started = Date.now();
  const attempts: Attempt[] = [];

  for (const target of targets) {
    for (let attempt = 0; attempt <= retriesPerTarget; attempt++) {
      const left = deadlineMs - (Date.now() - started);
      if (left <= 0) throw new FailoverError(attempts);
      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(target.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...target.headers },
          body: JSON.stringify({ ...body, model: target.model }),
          signal: AbortSignal.timeout(left),
        });
      } catch (err) {
        const timeout = (err as Error).name === "TimeoutError";
        attempts.push({ target: target.name, status: timeout ? "timeout" : "network", ms: Date.now() - t0 });
        if (timeout) throw new FailoverError(attempts); // the overall deadline is spent
        await sleep(backoff(attempt));
        continue;
      }
      if (res.ok) {
        if (attempts.length) console.warn("llm failover", { answeredBy: target.name, attempts });
        return { target: target.name, data: await res.json() };
      }
      attempts.push({ target: target.name, status: res.status, ms: Date.now() - t0 });
      if (!RETRYABLE.has(res.status)) throw new FailoverError(attempts); // a wrong request is wrong everywhere
      if (attempt < retriesPerTarget) await sleep(retryAfterMs(res) ?? backoff(attempt));
    }
  }
  throw new FailoverError(attempts);
}

function backoff(attempt: number) {
  const base = 500 * 3 ** attempt; // 0.5 s, 1.5 s, 4.5 s
  return base / 2 + Math.random() * base; // jitter
}
```

Usage:

```ts
const targets = [
  { name: "openai", url: "https://api.openai.com/v1/chat/completions",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, model: "gpt-6-sol" },
  { name: "azure", url: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/v1/chat/completions`,
    headers: { "api-key": process.env.AZURE_OPENAI_API_KEY! }, model: process.env.AZURE_DEPLOYMENT! },
];
const { target, data } = await chatWithFailover(targets, { messages, max_completion_tokens: 800 });
```

Turn the SDK's own retries off for calls that go through this helper
(`new OpenAI({ maxRetries: 0 })`), or one failure becomes nine attempts.

## Python (httpx)

```python
import random, time
import httpx

RETRYABLE = {408, 409, 429, 500, 502, 503, 504, 529}

class FailoverError(Exception):
    def __init__(self, attempts):
        self.attempts = attempts
        super().__init__("every target failed: " + ", ".join(f"{a['target']} {a['status']}" for a in attempts))

def _backoff(attempt: int) -> float:
    base = 0.5 * 3 ** attempt
    return base / 2 + random.random() * base

def _retry_after(res: httpx.Response) -> float | None:
    if ms := res.headers.get("retry-after-ms"):
        return float(ms) / 1000
    s = res.headers.get("retry-after")
    return float(s) if s and s.replace(".", "", 1).isdigit() else None

def chat_with_failover(targets, body, deadline_s=30.0, retries_per_target=2):
    started = time.monotonic()
    attempts = []
    with httpx.Client() as client:
        for t in targets:
            for attempt in range(retries_per_target + 1):
                left = deadline_s - (time.monotonic() - started)
                if left <= 0:
                    raise FailoverError(attempts)
                try:
                    res = client.post(t["url"], headers=t["headers"], json={**body, "model": t["model"]}, timeout=left)
                except httpx.TimeoutException:
                    attempts.append({"target": t["name"], "status": "timeout"})
                    raise FailoverError(attempts)
                except httpx.TransportError:
                    attempts.append({"target": t["name"], "status": "network"})
                    time.sleep(_backoff(attempt))
                    continue
                if res.is_success:
                    return t["name"], res.json()
                attempts.append({"target": t["name"], "status": res.status_code})
                if res.status_code not in RETRYABLE:
                    raise FailoverError(attempts)
                if attempt < retries_per_target:
                    time.sleep(_retry_after(res) or _backoff(attempt))
    raise FailoverError(attempts)
```

## Streaming

Open the stream, wait for the first chunk, and only then start forwarding it
to the user. An error before the first chunk goes through the same failover
loop; an error after it is reported to the user as a failed answer.

## Testing without a network

- TypeScript: replace `globalThis.fetch` in the test with a function that
  returns `new Response(JSON.stringify(...), { status: 503 })` for the first
  target and a success for the second. Use fake timers for backoff.
- Python: `httpx.MockTransport` with a handler keyed on the request URL.
