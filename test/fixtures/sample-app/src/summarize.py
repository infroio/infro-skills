import anthropic

client = anthropic.Anthropic()

def summarize(doc: str) -> str:
    msg = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=1024,
        system="You are a careful summarizer. Follow the house style guide below...",
        messages=[{"role": "user", "content": doc}],
    )
    return msg.content[0].text
