import { GoogleGenAI } from "@google/genai";
import type { AgentResult, BiasSignal, Claim, Entity, PageContext } from "@packages/core";

const MODEL = "gemini-2.5-flash";

export async function runBiasAgent(
  apiKey: string,
  pages: PageContext[],
  claims: Claim[],
  entities: Entity[],
): Promise<AgentResult<{ biasSignals: BiasSignal[] }>> {
  const start = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });

    const claimList = claims
      .map((c) => `[${c.id}] "${c.text}" (${c.category}, confidence: ${c.confidence}, source: ${c.sourcePageUrl})`)
      .join("\n");

    const entityList = entities.map((e) => `[${e.id}] ${e.name} (${e.type})`).join("\n");

    const pageList = pages
      .map((p, i) => `[Page ${i + 1}] ${p.title ?? "Untitled"} — ${p.url}\n${p.contentText.slice(0, 1500)}`)
      .join("\n\n");

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a bias and framing analysis agent. Your stance is depolarized and evidence-weighted — you surface signals without declaring verdicts.

Analyze the following claims, entities, and source pages. Return strict JSON:

**biasSignals**: Array of detected bias indicators. Each needs:
   - type: "political-lean" | "emotional-language" | "framing-technique" | "omission" | "source-selection"
   - description: what the bias signal is (1-2 sentences)
   - severity: "high" | "medium" | "low"
   - evidence: quote or reference from the text
   - claimIds: array of claim IDs this signal relates to

Return: {"biasSignals": [...]}

Claims:
${claimList || "No claims extracted."}

Entities:
${entityList || "No entities extracted."}

Pages:
${pageList}`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}") as { biasSignals?: BiasSignal[] };

    return {
      agent: "bias",
      durationMs: Date.now() - start,
      ok: true,
      data: {
        biasSignals: Array.isArray(parsed.biasSignals) ? parsed.biasSignals : [],
      },
      error: null,
    };
  } catch (err) {
    return {
      agent: "bias",
      durationMs: Date.now() - start,
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Bias agent failed.",
    };
  }
}
