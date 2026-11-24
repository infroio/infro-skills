import OpenAI from "openai";
const client = new OpenAI();

export async function tagAll(tickets: string[]) {
  for (const t of tickets) {
    const res = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: `Tag this ticket: ${t}` }],
    });
    console.log(res.choices[0].message.content);
  }
}

export async function newer() {
  return client.chat.completions.create({ model: "gpt-5.5", max_completion_tokens: 300, messages: [] });
}
