import type { AgentResult, BiasSignal, CredibilityScore, Claim, Entity, PageContext } from "@packages/core";
import { runBiasAgent } from "./bias";
import { runCredibilityAgent } from "./credibility";

type AnalysisResult = {
  biasSignals: BiasSignal[];
  credibilityScores: CredibilityScore[];
};

/**
 * Runs bias and credibility agents in parallel (same combined output as legacy single-call analysis).
 * Used by `POST /analyze/bias` and tests that expect one envelope.
 */
export async function runAnalysisAgent(
  apiKey: string,
  pages: PageContext[],
  claims: Claim[],
  entities: Entity[],
): Promise<AgentResult<AnalysisResult>> {
  const start = Date.now();
  const [bias, cred] = await Promise.all([
    runBiasAgent(apiKey, pages, claims, entities),
    runCredibilityAgent(apiKey, pages, claims, entities),
  ]);

  const biasSignals = bias.ok && bias.data ? bias.data.biasSignals : [];
  const credibilityScores = cred.ok && cred.data ? cred.data.credibilityScores : [];

  const ok = (bias.ok && bias.data !== null) || (cred.ok && cred.data !== null);
  const errMsg = [bias.error, cred.error].filter(Boolean).join(" | ");

  return {
    agent: "analysis",
    durationMs: Date.now() - start,
    ok,
    data: {
      biasSignals,
      credibilityScores,
    },
    error: ok ? null : errMsg || "Bias and credibility agents failed.",
  };
}
