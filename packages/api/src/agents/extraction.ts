import { GoogleGenAI } from "@google/genai";
import type { Claim, Entity, AgentResult, PageContext } from "@packages/core";

type ExtractionResult = {
  claims: Claim[];
  entities: Entity[];
};

const EXTRACTION_MODEL = "gemini-2.5-flash";

export async function runExtractionAgent(
  apiKey: string,
  pages: PageContext[],
): Promise<AgentResult<ExtractionResult>> {
  const start = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });

    const pageTexts = pages
      .map((p, i) => `[Page ${i + 1}: ${p.title ?? "Untitled"} — ${p.url}]\n${p.contentText.slice(0, 3000)}`)
      .join("\n\n---\n\n");

    const response = await ai.models.generateContent({
      model: EXTRACTION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are an entity and claim extraction agent. Analyze the following page(s) and extract:

1. **Claims**: Factual assertions, opinions presented as fact, predictions, and framing choices. Each claim needs:
   - id: a short unique identifier like "c1", "c2"
   - text: the claim as stated
   - sourcePageUrl: which page URL it came from
   - confidence: how clearly stated ("high", "medium", "low")
   - category: "factual", "opinion", "prediction", or "framing"

2. **Entities**: People, organizations, locations, events, and concepts mentioned. Each needs:
   - id: short unique identifier like "e1", "e2"
   - name: the entity name
   - type: "person", "organization", "location", "event", or "concept"
   - mentions: array of {pageUrl, snippet} showing where it appears

Return strict JSON: {"claims": [...], "entities": [...]}
Keep claims concise. Extract the 10-20 most significant claims and 5-15 key entities.

Pages:
${pageTexts}`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}") as Partial<ExtractionResult>;

    return {
      agent: "extraction",
      durationMs: Date.now() - start,
      ok: true,
      data: {
        claims: Array.isArray(parsed.claims) ? parsed.claims : [],
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      },
      error: null,
    };
  } catch (err) {
    return {
      agent: "extraction",
      durationMs: Date.now() - start,
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Extraction agent failed.",
    };
  }
}
