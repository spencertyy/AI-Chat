import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(request: Request) {
  const { messages } = await request.json();

  const MAX_TURNS = 10;
  const recentMessages = messages.slice(-MAX_TURNS * 2); // Get the last 10 turns (user + assistant)

  const conversation = recentMessages
    .map((msg: { role: string; content: string }) => {
      const speaker = msg.role === "assistant" ? "model" : "user";
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");

  const prompt = [
    "You are a helpful assistant.",
    "Continue the conversation based on the following history:",
    conversation,
    "Assistant:",
  ].join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await genAI.models.generateContentStream({
          model: "gemini-2.5-flash",
          contents: prompt,
        });

        for await (const chunk of result) {
          const text = chunk.text ?? "";
          if (text) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            ); //把 Gemini 的 chunk 包成 SSE（ server-sent events）格式。
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: any) {
        console.error("Gemini streaming error:", error);

        const message =
          error?.status === 429
            ? "Gemini free quota exceeded. Please wait and try again later."
            : "Something went wrong.";

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: message,
            })}\n\n`
          )
        );
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
