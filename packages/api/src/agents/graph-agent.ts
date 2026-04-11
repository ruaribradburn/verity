import { GoogleGenAI } from "@google/genai";
import type { AgentResult, Claim, Entity } from "@packages/core";
import { entityKey, insertEdges, sessionEdgeSummary, upsertEntities } from "../graph/store";

const MODEL = "gemini-2.5-flash";

type GraphAgentResult = { summary: string };

/**
 * Persists entities and proposed relationships for this session; returns a short text summary for synthesis.
 */
export async function runGraphAgent(
  apiKey: string,
  sessionId: string,
  claims: Claim[],
  entities: Entity[],
): Promise<AgentResult<GraphAgentResult>> {
  const start = Date.now();
  if (entities.length === 0) {
    return {
      agent: "graph",
      durationMs: Date.now() - start,
      ok: true,
      data: { summary: "" },
      error: null,
    };
  }

  try {
    upsertEntities(entities);

    const ai = new GoogleGenAI({ apiKey });

    const claimList = claims
      .map((c) => `[${c.id}] "${c.text}"`)
      .slice(0, 25)
      .join("\n");

    const entityList = entities
      .map((e) => `[${e.id}] key=${entityKey(e)} | ${e.name} (${e.type})`)
      .join("\n");

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You propose relationship edges between entities for a knowledge graph.

Allowed relation types (use exactly one per edge): "ownership", "influence", "contradiction", "collaboration", "affiliation", "other".

Return strict JSON:
{
  "edges": [
    {
      "fromKey": "person:alice",
      "toKey": "organization:acme",
      "relation": "affiliation",
      "confidence": 0.7,
      "claimIds": ["c1"]
    }
  ]
}

Use entity keys exactly as given (format type:lowercased name).

Claims (context):
${claimList || "(none)"}

Entities:
${entityList}`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}") as {
      edges?: Array<{
        fromKey?: string;
        toKey?: string;
        relation?: string;
        confidence?: number;
        claimIds?: string[];
      }>;
    };

    const keySet = new Set(entities.map(entityKey));
    const raw = Array.isArray(parsed.edges) ? parsed.edges : [];
    const edges = raw
      .filter((e) => e.fromKey && e.toKey && e.relation)
      .map((e) => ({
        fromKey: String(e.fromKey),
        toKey: String(e.toKey),
        relation: String(e.relation),
        confidence: typeof e.confidence === "number" ? Math.min(1, Math.max(0, e.confidence)) : 0.5,
        claimIds: Array.isArray(e.claimIds) ? e.claimIds.map(String) : [],
      }))
      .filter((e) => keySet.has(e.fromKey) && keySet.has(e.toKey) && e.fromKey !== e.toKey);

    insertEdges(sessionId, edges);

    const keys = entities.map(entityKey);
    const summary =
      sessionEdgeSummary(sessionId, keys) ||
      edges.map((e) => `${e.fromKey} —[${e.relation}]→ ${e.toKey}`).join("\n");

    return {
      agent: "graph",
      durationMs: Date.now() - start,
      ok: true,
      data: {
        summary: summary.slice(0, 8000),
      },
      error: null,
    };
  } catch (err) {
    return {
      agent: "graph",
      durationMs: Date.now() - start,
      ok: false,
      data: { summary: "" },
      error: err instanceof Error ? err.message : "Graph agent failed.",
    };
  }
}
