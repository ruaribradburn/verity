import { GoogleGenAI } from "@google/genai";
import type { AgentResult, Claim, PageContext } from "@packages/core";

const MODEL = "gemini-2.5-flash";

/** Per-claim web research cues from Google Search grounding (server-side). */
export type ResearchCue = {
  claimId: string;
  items: Array<{ url: string; snippet: string; title?: string }>;
};

type ResearchResult = { cues: ResearchCue[] };

/**
 * Uses Gemini + Google Search to find independent sources relevant to extracted claims.
 * Complements extension-side page research (user-opened / SERP pages).
 */
export async function runResearchAgent(
  apiKey: string,
  pages: PageContext[],
  claims: Claim[],
  userPrompt: string,
): Promise<AgentResult<ResearchResult>> {
  const start = Date.now();
  if (claims.length === 0) {
    return {
      agent: "research",
      durationMs: Date.now() - start,
      ok: true,
      data: { cues: [] },
      error: null,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const claimList = claims
      .map((c) => `[${c.id}] "${c.text}" (source: ${c.sourcePageUrl})`)
      .join("\n");

    const pageHint = pages
      .map((p) => `- ${p.title ?? p.url} (${p.url})`)
      .slice(0, 8)
      .join("\n");

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a research agent. Use Google Search to find independent sources that help verify or contextualize the claims below.

For EACH claim ID, search as needed and list up to 4 distinct sources (URLs) with a short snippet of what each source says relative to that claim.
Prefer reputable outlets, primary documents, and data sources when available.

Return strict JSON only:
{
  "cues": [
    {
      "claimId": "c1",
      "items": [
        { "url": "https://...", "snippet": "1-2 sentence note", "title": "optional" }
      ]
    }
  ]
}

User focus: ${userPrompt}

Pages being analyzed:
${pageHint || "(none)"}

Claims:
${claimList}`,
            },
          ],
        },
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        temperature: 0,
      } as Record<string, unknown>,
    });

    const parsed = JSON.parse(response.text ?? "{}") as Partial<ResearchResult>;
    const cues = Array.isArray(parsed.cues)
      ? parsed.cues.map((c) => ({
          claimId: String(c.claimId ?? ""),
          items: Array.isArray(c.items)
            ? c.items.map((i) => ({
                url: String(i.url ?? ""),
                snippet: String(i.snippet ?? ""),
                title: i.title != null ? String(i.title) : undefined,
              }))
            : [],
        }))
      : [];

    return {
      agent: "research",
      durationMs: Date.now() - start,
      ok: true,
      data: { cues },
      error: null,
    };
  } catch (err) {
    return {
      agent: "research",
      durationMs: Date.now() - start,
      ok: false,
      data: { cues: [] },
      error: err instanceof Error ? err.message : "Research agent failed.",
    };
  }
}
