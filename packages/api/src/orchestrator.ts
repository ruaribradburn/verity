import type {
  AgentResult,
  AnalysisContext,
  OrchestrationRequest,
  OrchestrationResponse,
} from "@packages/core";
import { runExtractionAgent } from "./agents/extraction";
import { runAnalysisAgent } from "./agents/analysis";
import { runSynthesisAgent } from "./agents/synthesis";

const ORCHESTRATOR_TIMEOUT_MS = 30_000;

export async function runOrchestration(
  apiKey: string,
  request: OrchestrationRequest,
): Promise<OrchestrationResponse> {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agents: AgentResult<unknown>[] = [];

  // All input pages: user-provided + research contexts
  const allPages = [
    ...request.pages,
    ...(request.researchContexts ?? []),
  ];

  // Build initial context
  const context: AnalysisContext = {
    sessionId,
    pages: allPages,
    claims: [],
    entities: [],
    biasSignals: [],
    evidenceBundles: [],
    credibilityScores: [],
    language: "en",
  };

  try {
    // Step 1: Extraction — must complete before analysis
    const extraction = await withTimeout(
      runExtractionAgent(apiKey, allPages),
      ORCHESTRATOR_TIMEOUT_MS,
      "extraction",
    );
    agents.push(extraction);

    if (extraction.ok && extraction.data) {
      context.claims = extraction.data.claims;
      context.entities = extraction.data.entities;
    }

    // Step 2: Analysis — uses extraction results
    const analysis = await withTimeout(
      runAnalysisAgent(apiKey, allPages, context.claims, context.entities),
      ORCHESTRATOR_TIMEOUT_MS,
      "analysis",
    );
    agents.push(analysis);

    if (analysis.ok && analysis.data) {
      context.biasSignals = analysis.data.biasSignals;
      context.credibilityScores = analysis.data.credibilityScores;
    }

    // Step 3: Synthesis — merges everything into a briefing
    const synthesis = await withTimeout(
      runSynthesisAgent(apiKey, context, request.userPrompt),
      ORCHESTRATOR_TIMEOUT_MS,
      "synthesis",
    );
    agents.push(synthesis);

    if (synthesis.ok && synthesis.data) {
      return {
        ok: true,
        briefing: synthesis.data,
        context,
        agents,
      };
    }

    // Synthesis failed but we have partial context
    return {
      ok: false,
      error: synthesis.error ?? "Synthesis agent did not produce a briefing.",
      partialContext: context,
      agents,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Orchestration failed.",
      partialContext: context,
      agents,
    };
  }
}

async function withTimeout<T>(
  promise: Promise<AgentResult<T>>,
  ms: number,
  agentName: string,
): Promise<AgentResult<T>> {
  return Promise.race([
    promise,
    new Promise<AgentResult<T>>((resolve) =>
      setTimeout(
        () =>
          resolve({
            agent: agentName,
            durationMs: ms,
            ok: false,
            data: null,
            error: `Agent "${agentName}" timed out after ${ms}ms.`,
          }),
        ms,
      ),
    ),
  ]);
}
