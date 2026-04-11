import { GoogleGenAI } from "@google/genai";
import type { AgentResult, BiasSignal, CredibilityScore, Claim, Entity, PageContext } from "@packages/core";

type AnalysisResult = {
  biasSignals: BiasSignal[];
  credibilityScores: CredibilityScore[];
};

const ANALYSIS_MODEL = "gemini-2.5-flash";

export async function runAnalysisAgent(
  apiKey: string,
  pages: PageContext[],
  claims: Claim[],
  entities: Entity[],
): Promise<AgentResult<AnalysisResult>> {
  const start = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });

    const claimList = claims
      .map((c) => `[${c.id}] "${c.text}" (${c.category}, confidence: ${c.confidence}, source: ${c.sourcePageUrl})`)
      .join("\n");

    const entityList = entities
      .map((e) => `[${e.id}] ${e.name} (${e.type})`)
      .join("\n");

    const pageList = pages
      .map((p, i) => `[Page ${i + 1}] ${p.title ?? "Untitled"} — ${p.url}\n${p.contentText.slice(0, 1500)}`)
      .join("\n\n");

    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a bias and credibility analysis agent. Your stance is depolarized and evidence-weighted — you surface signals without declaring verdicts.

Analyze the following claims, entities, and source pages. Return strict JSON with:

1. **biasSignals**: Array of detected bias indicators. Each needs:
   - type: "political-lean" | "emotional-language" | "framing-technique" | "omission" | "source-selection"
   - description: what the bias signal is (1-2 sentences)
   - severity: "high" | "medium" | "low"
   - evidence: quote or reference from the text
   - claimIds: array of claim IDs this signal relates to

2. **credibilityScores**: Array of per-page credibility assessments. Each needs:
   - pageUrl: the page URL
   - score: 0-1 float (1 = highly credible heuristic, 0 = very low)
   - rationale: why this score (1-2 sentences)
   - caveats: array of limitations of this assessment

Be calibrated: use the full 0-1 range. Note uncertainty. Do not manufacture symmetry when evidence is one-sided.

Return: {"biasSignals": [...], "credibilityScores": [...]}

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

    const parsed = JSON.parse(response.text ?? "{}") as Partial<AnalysisResult>;

    return {
      agent: "analysis",
      durationMs: Date.now() - start,
      ok: true,
      data: {
        biasSignals: Array.isArray(parsed.biasSignals) ? parsed.biasSignals : [],
        credibilityScores: Array.isArray(parsed.credibilityScores) ? parsed.credibilityScores : [],
      },
      error: null,
    };
  } catch (err) {
    return {
      agent: "analysis",
      durationMs: Date.now() - start,
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Analysis agent failed.",
    };
  }
}
