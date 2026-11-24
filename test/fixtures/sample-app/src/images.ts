import OpenAI from "openai";
const client = new OpenAI();
export const cover = (prompt: string) => client.images.generate({ model: "gpt-image-1.5", prompt });
