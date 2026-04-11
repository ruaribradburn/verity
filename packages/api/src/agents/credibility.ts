import { GoogleGenAI } from "@google/genai";
import type { AgentResult, Claim, CredibilityScore, Entity, PageContext } from "@packages/core";

const MODEL = "gemini-2.5-flash";

export async function runCredibilityAgent(
  apiKey: string,
  pages: PageContext[],
  claims: Claim[],
  entities: Entity[],
): Promise<AgentResult<{ credibilityScores: CredibilityScore[] }>> {
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
              text: `You are a source credibility analyst. Your stance is depolarized and evidence-weighted — heuristic scores with caveats, not verdicts on truth.

Analyze the following claims, entities, and source pages. Return strict JSON:

**credibilityScores**: Array of per-page credibility assessments. Each needs:
   - pageUrl: the page URL
   - score: 0-1 float (1 = highly credible heuristic, 0 = very low)
   - rationale: why this score (1-2 sentences)
   - caveats: array of limitations of this assessment

Be calibrated: use the full 0-1 range. Note uncertainty.

Return: {"credibilityScores": [...]}

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

    const parsed = JSON.parse(response.text ?? "{}") as { credibilityScores?: CredibilityScore[] };

    return {
      agent: "credibility",
      durationMs: Date.now() - start,
      ok: true,
      data: {
        credibilityScores: Array.isArray(parsed.credibilityScores) ? parsed.credibilityScores : [],
      },
      error: null,
    };
  } catch (err) {
    return {
      agent: "credibility",
      durationMs: Date.now() - start,
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Credibility agent failed.",
    };
  }
}
