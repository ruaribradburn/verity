import { GoogleGenAI } from "@google/genai";
import type { AgentResult, Claim, EvidenceBundle } from "@packages/core";
import type { ResearchCue } from "./research";

const MODEL = "gemini-2.5-flash";

/**
 * Maps claims + research cues into structured evidence bundles (supports / contradicts / unresolved).
 */
export async function runFactCheckAgent(
  apiKey: string,
  claims: Claim[],
  cues: ResearchCue[],
): Promise<AgentResult<{ evidenceBundles: EvidenceBundle[] }>> {
  const start = Date.now();
  if (claims.length === 0) {
    return {
      agent: "fact-check",
      durationMs: Date.now() - start,
      ok: true,
      data: { evidenceBundles: [] },
      error: null,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const claimList = claims
      .map((c) => `[${c.id}] "${c.text}" (${c.category}, ${c.confidence})`)
      .join("\n");

    const cueText = cues
      .map((c) => {
        const lines = c.items.map((i) => `    - ${i.url}\n      ${i.snippet}`).join("\n");
        return `  ${c.claimId}:\n${lines || "    (no URLs)"}`;
      })
      .join("\n");

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a fact-check agent. Given claims and research URLs/snippets, build evidence bundles.

Rules:
- Do NOT declare absolute truth or falsehood; use supports / contradicts / unresolved.
- Map each claim ID to exactly one bundle object.
- **supports** / **contradicts** entries need sourceUrl, snippet, strength ("strong" | "moderate" | "weak").
- If research is thin or conflicting, set **unresolved**: true.

Return strict JSON:
{
  "evidenceBundles": [
    {
      "claimId": "c1",
      "supports": [{ "sourceUrl": "...", "snippet": "...", "strength": "moderate" }],
      "contradicts": [],
      "unresolved": false
    }
  ]
}

Claims:
${claimList}

Research cues (from web search):
${cueText || "(none — mark bundles unresolved or empty as appropriate)"}`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}") as { evidenceBundles?: EvidenceBundle[] };
    const bundles = Array.isArray(parsed.evidenceBundles) ? parsed.evidenceBundles : [];

    return {
      agent: "fact-check",
      durationMs: Date.now() - start,
      ok: true,
      data: { evidenceBundles: bundles },
      error: null,
    };
  } catch (err) {
    return {
      agent: "fact-check",
      durationMs: Date.now() - start,
      ok: false,
      data: { evidenceBundles: [] },
      error: err instanceof Error ? err.message : "Fact-check agent failed.",
    };
  }
}
