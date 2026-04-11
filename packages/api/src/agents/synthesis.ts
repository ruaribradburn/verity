import { GoogleGenAI } from "@google/genai";
import type { AgentResult, AnalysisContext, Briefing } from "@packages/core";

const SYNTHESIS_MODEL = "gemini-2.5-flash";

export async function runSynthesisAgent(
  apiKey: string,
  context: AnalysisContext,
  userPrompt: string,
): Promise<AgentResult<Briefing>> {
  const start = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });

    const claimSummary = context.claims
      .map((c) => `[${c.id}] ${c.text} (${c.category}, ${c.confidence})`)
      .join("\n");

    const entitySummary = context.entities
      .map((e) => `${e.name} (${e.type})`)
      .join(", ");

    const biasSummary = context.biasSignals
      .map((b) => `- ${b.type}: ${b.description} [severity: ${b.severity}]`)
      .join("\n");

    const credSummary = context.credibilityScores
      .map((c) => `- ${c.pageUrl}: ${c.score.toFixed(2)} — ${c.rationale}`)
      .join("\n");

    const evidenceSummary = context.evidenceBundles
      .map((e) => {
        const sup = e.supports.map((s) => `  + ${s.snippet} (${s.strength})`).join("\n");
        const con = e.contradicts.map((s) => `  - ${s.snippet} (${s.strength})`).join("\n");
        return `Claim ${e.claimId}:\n${sup}\n${con}${e.unresolved ? "\n  ? Unresolved" : ""}`;
      })
      .join("\n");

    const pageTitles = context.pages
      .map((p) => `${p.title ?? "Untitled"} (${p.siteName ?? p.url})`)
      .join(", ");

    const response = await ai.models.generateContent({
      model: SYNTHESIS_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are Verity's synthesis agent. Produce a depolarized, evidence-aware analytical briefing.

EPISTEMIC RULES (mandatory):
- Do NOT say "this is true" or "this is false" unless evidence is unusually clear AND you state the basis and limits.
- Prefer language of support, uncertainty, disagreement, and limits.
- Where the source is emotionally loaded or one-sided, restate what is claimed in calmer language without endorsing it.
- Do NOT create false balance when evidence is strongly one-sided.
- The user retains judgment — you supply structure, context, and traceability.

USER QUESTION: ${userPrompt}

ANALYZED PAGES: ${pageTitles}

CLAIMS EXTRACTED:
${claimSummary || "None extracted."}

ENTITIES: ${entitySummary || "None extracted."}

BIAS SIGNALS:
${biasSummary || "None detected."}

CREDIBILITY ASSESSMENTS:
${credSummary || "None computed."}

EVIDENCE BUNDLES:
${evidenceSummary || "None assembled."}

Produce a briefing with these 6 sections as strict JSON:
{
  "summary": "Neutral restatement of main claims and stakes. Note loaded language without amplifying it.",
  "framingAndBias": "How the piece(s) lean — emotion, omission, partisan cues. Alternative framings.",
  "evidenceAndCredibility": "Source quality cues. What can/cannot be verified. Cite claim IDs.",
  "entitiesAndRelationships": "Key entities and how they connect. Note power dynamics or conflicts of interest.",
  "missingContextAndOpposing": "Gaps, missing stakeholders, good-faith counterarguments or mainstream counter-narratives.",
  "whatToReadNext": "Suggestions for verification and perspective — primary sources, diverse outlets. Recommendations, not commands.",
  "metadata": {
    "confidence": "high" | "medium" | "low",
    "languages": ["en"]
  }
}

Each section should be 2-5 sentences. Be concise and analytically useful.`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}") as Record<string, unknown>;

    const briefing: Briefing = {
      summary: String(parsed.summary ?? ""),
      framingAndBias: String(parsed.framingAndBias ?? ""),
      evidenceAndCredibility: String(parsed.evidenceAndCredibility ?? ""),
      entitiesAndRelationships: String(parsed.entitiesAndRelationships ?? ""),
      missingContextAndOpposing: String(parsed.missingContextAndOpposing ?? ""),
      whatToReadNext: String(parsed.whatToReadNext ?? ""),
      metadata: {
        sessionId: context.sessionId,
        agentContributions: [
          { agent: "extraction", summary: `${context.claims.length} claims, ${context.entities.length} entities` },
          { agent: "analysis", summary: `${context.biasSignals.length} bias signals, ${context.credibilityScores.length} credibility scores` },
          { agent: "synthesis", summary: "Produced 6-section briefing" },
        ],
        confidence: (parsed.metadata as Record<string, unknown>)?.confidence === "high"
          ? "high"
          : (parsed.metadata as Record<string, unknown>)?.confidence === "low"
            ? "low"
            : "medium",
        languages: Array.isArray((parsed.metadata as Record<string, unknown>)?.languages)
          ? ((parsed.metadata as Record<string, unknown>).languages as string[])
          : [context.language],
        durationMs: Date.now() - start,
      },
    };

    return {
      agent: "synthesis",
      durationMs: Date.now() - start,
      ok: true,
      data: briefing,
      error: null,
    };
  } catch (err) {
    return {
      agent: "synthesis",
      durationMs: Date.now() - start,
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Synthesis agent failed.",
    };
  }
}
