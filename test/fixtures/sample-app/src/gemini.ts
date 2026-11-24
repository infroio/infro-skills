import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({});
export async function answer(q: string) {
  const r = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: q });
  return r.text;
}
