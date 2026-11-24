import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
export const draft = (prompt: string) =>
  generateText({ model: openai("gpt-6-sol"), maxOutputTokens: 500, prompt });
