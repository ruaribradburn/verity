import type {
  AgentResult,
  AnalysisContext,
  OrchestrationRequest,
  OrchestrationResponse,
} from "@packages/core";
import { runExtractionAgent } from "./agents/extraction";
import { runBiasAgent } from "./agents/bias";
import { runCredibilityAgent } from "./agents/credibility";
import { runResearchAgent } from "./agents/research";
import { runFactCheckAgent } from "./agents/fact-check";
import { runGraphAgent } from "./agents/graph-agent";
import { runSynthesisAgent } from "./agents/synthesis";

const ORCHESTRATOR_TIMEOUT_MS = 30_000;

export async function runOrchestration(
  apiKey: string,
  request: OrchestrationRequest,
): Promise<OrchestrationResponse> {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agents: AgentResult<unknown>[] = [];

  const allPages = [...request.pages, ...(request.researchContexts ?? [])];

  const context: AnalysisContext = {
    sessionId,
    pages: allPages,
    claims: [],
    entities: [],
    biasSignals: [],
    evidenceBundles: [],
    credibilityScores: [],
    language: "en",
    graphSummary: "",
  };

  try {
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

    const [research, bias, credibility, graph] = await Promise.all([
      withTimeout(
        runResearchAgent(apiKey, allPages, context.claims, request.userPrompt),
        ORCHESTRATOR_TIMEOUT_MS,
        "research",
      ),
      withTimeout(runBiasAgent(apiKey, allPages, context.claims, context.entities), ORCHESTRATOR_TIMEOUT_MS, "bias"),
      withTimeout(
        runCredibilityAgent(apiKey, allPages, context.claims, context.entities),
        ORCHESTRATOR_TIMEOUT_MS,
        "credibility",
      ),
      withTimeout(
        runGraphAgent(apiKey, sessionId, context.claims, context.entities),
        ORCHESTRATOR_TIMEOUT_MS,
        "graph",
      ),
    ]);

    agents.push(research, bias, credibility, graph);

    if (bias.ok && bias.data) {
      context.biasSignals = bias.data.biasSignals;
    }
    if (credibility.ok && credibility.data) {
      context.credibilityScores = credibility.data.credibilityScores;
    }
    if (graph.ok && graph.data) {
      context.graphSummary = graph.data.summary;
    }

    const researchCues = research.ok && research.data ? research.data.cues : [];

    const factCheck = await withTimeout(
      runFactCheckAgent(apiKey, context.claims, researchCues),
      ORCHESTRATOR_TIMEOUT_MS,
      "fact-check",
    );
    agents.push(factCheck);

    if (factCheck.ok && factCheck.data) {
      context.evidenceBundles = factCheck.data.evidenceBundles;
    }

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
