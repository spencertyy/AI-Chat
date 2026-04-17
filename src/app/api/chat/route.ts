import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Parts } from "openai/resources/uploads.js";

const genAI = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages is required" },
        { status: 400 }
      );
    }

    const conversation = messages
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

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const reply = response.text ?? "Sorry, I couldn't generate a response.";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Gemini error", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
