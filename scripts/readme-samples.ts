// 临时脚本：为 README 截图生成真实人格回复，并过一遍 personaGuard 验证。
// 用法: npx tsx scripts/readme-samples.ts [personaId ...]   （跑完即删，不入库）
import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
import { getPersona, buildSystemPrompt } from "../src/app/lib/personas";
import { checkOutput } from "../src/app/lib/personaGuard";

config({ path: ".env.local" });

const SCENARIOS = [
  'He replied after 3 days: "sorry, been super busy lately, let\'s hang out when things calm down." What do I say?',
  'She finally texted back: "haha yeah we should definitely do something soon." How do I reply?',
];

const ROUNDS = 5;

async function main() {
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["gentle"];

  for (const id of ids) {
    const persona = getPersona(id)!;
    const systemPrompt = buildSystemPrompt(persona);

    for (const [si, question] of SCENARIOS.entries()) {
      console.log(`\n===== ${persona.name} · scenario ${si + 1} =====`);
      for (let i = 1; i <= ROUNDS; i++) {
        const res = await genAI.models.generateContent({
          model: persona.defaultModelId,
          contents: [{ role: "user", parts: [{ text: question }] }],
          config: { systemInstruction: systemPrompt, temperature: 0.7 },
        });
        const text = res.text?.trim() ?? "";
        const guard = checkOutput(text, persona);
        const verdict = guard.ok
          ? "✅ guard pass"
          : guard.violations.map((v) => `❌ ${v.severity}: ${v.detail}`).join(" | ");
        console.log(`\n--- round ${i} [${verdict}] ---\n${text}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
