import { serve } from "@hono/node-server";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  API_DEFAULT_PORT,
  APP_WORKSPACE,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_AFFECTIVE_DIALOG,
  GEMINI_LIVE_SPEECH_LANGUAGE_CODE,
  GEMINI_LIVE_TEMPERATURE,
  GEMINI_LIVE_VOICE,
  analyzePage,
  buildPageContext,
  createFixtureRequests,
  createLiveConfigSummary,
  resolveGeminiApiKey,
  runFixtureAssertions,
  type AnalysisRequest,
  type AnalyzeHttpResponse,
  type HealthResponse,
  type LiveConfigHttpResponse,
  type LiveTokenHttpResponse,
} from "../core";

function parseCorsOrigins(raw: string | undefined): string[] {
  const origins = !raw?.trim()
    ? ["http://localhost:3000", "http://127.0.0.1:3000"]
    : raw
        .split(",")
        .map((value) => value.trim().replace(/\/$/, ""))
        .filter(Boolean);

  if (process.env.VERITY_ALLOW_EXTENSION_CORS === "1") {
    console.log("[verity/api] Extension CORS enabled — chrome-extension:// origins will be allowed");
  }

  return origins;
}

function normalizeRequest(input: Partial<AnalysisRequest>): AnalysisRequest {
  return {
    mode: input.mode ?? "analyst",
    userPrompt: input.userPrompt?.trim() || "What am I missing here?",
    page: buildPageContext({
      url: input.page?.url ?? "https://example.com/current-page",
      title: input.page?.title ?? null,
      siteName: input.page?.siteName ?? null,
      publishedAt: input.page?.publishedAt ?? null,
      contentText: input.page?.contentText ?? "",
      selectionText: input.page?.selectionText ?? null,
    }),
  };
}

const apiPort = Number(process.env.API_PORT ?? process.env.PORT) || API_DEFAULT_PORT;
const webPort = process.env.WEB_PORT;
if (webPort != null && String(apiPort) === String(webPort)) {
  console.error(
    "[verity/api] WEB_PORT and API_PORT must differ (both are %s). Fix your .env.",
    apiPort,
  );
  process.exit(1);
}

const app = new Hono();
const allowedOrigins = parseCorsOrigins(process.env.WEB_ORIGIN);
const geminiApiKey = resolveGeminiApiKey(process.env);

app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return allowedOrigins[0];
      if (allowedOrigins.includes(origin)) return origin;
      if (
        process.env.VERITY_ALLOW_EXTENSION_CORS === "1" &&
        origin.startsWith("chrome-extension://")
      ) {
        return origin;
      }
      return null;
    },
  }),
);

app.get("/health", (c) => {
  const body: HealthResponse = {
    ok: true,
    workspace: APP_WORKSPACE,
    service: "api",
    mode: "deterministic-local",
  };
  return c.json(body);
});

app.get("/fixtures", (c) => c.json({ ok: true, fixtures: createFixtureRequests() }));

app.get("/live/config", (c) => {
  console.log("[verity/api] GET /live/config from origin:", c.req.header("origin") ?? "none");
  const body: LiveConfigHttpResponse = {
    ok: true,
    live: createLiveConfigSummary(),
    hasServerKey: Boolean(geminiApiKey),
    tokenEndpoint: "/live/token",
  };
  return c.json(body);
});

app.post("/live/token", async (c) => {
  console.log("[verity/api] POST /live/token from origin:", c.req.header("origin") ?? "none");

  if (!geminiApiKey) {
    console.warn("[verity/api] POST /live/token — GEMINI_API_KEY not set, returning 503");
    const body: LiveTokenHttpResponse = {
      ok: false,
      authMode: "unavailable",
      error:
        "Gemini Live is not configured. Set GEMINI_API_KEY on the server and request ephemeral tokens from /live/token.",
      warnings: ["Browser clients should use ephemeral tokens rather than a long-lived API key."],
    };
    return c.json(body, 503);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      apiVersion: GEMINI_LIVE_API_VERSION,
    });

    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: GEMINI_LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            temperature: GEMINI_LIVE_TEMPERATURE,
            enableAffectiveDialog: GEMINI_LIVE_AFFECTIVE_DIALOG,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MINIMAL,
            },
            speechConfig: {
              languageCode: GEMINI_LIVE_SPEECH_LANGUAGE_CODE,
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: GEMINI_LIVE_VOICE,
                },
              },
            },
          },
        },
      },
    });

    if (!token.name) {
      throw new Error("Gemini did not return an ephemeral token name.");
    }

    console.log("[verity/api] POST /live/token — ephemeral token created successfully");
    const body: LiveTokenHttpResponse = {
      ok: true,
      authMode: "ephemeral-token",
      token: token.name,
      model: GEMINI_LIVE_MODEL,
      apiVersion: GEMINI_LIVE_API_VERSION,
      expiresAt: null,
      warnings: [
        "Use sendRealtimeInput for runtime text, audio, and video.",
        "Reserve sendClientContent for initial seeded history only.",
      ],
    };
    return c.json(body);
  } catch (error) {
    console.error("[verity/api] POST /live/token — token creation failed:", error instanceof Error ? error.message : error);
    const body: LiveTokenHttpResponse = {
      ok: false,
      authMode: "unavailable",
      error: error instanceof Error ? error.message : "Failed to create ephemeral token.",
      warnings: ["The server-side Gemini credential is present, but token creation failed."],
    };
    return c.json(body, 500);
  }
});

app.get("/validate", (c) =>
  c.json({
    ok: true,
    results: runFixtureAssertions(),
  }),
);

app.post("/analyze", async (c) => {
  let payload: Partial<AnalysisRequest>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const request = normalizeRequest(payload);
  if (!request.page.contentText.trim()) {
    return c.json(
      {
        ok: false,
        error: "Page content is required. Provide page.contentText with the extracted article text.",
      },
      400,
    );
  }

  const response: AnalyzeHttpResponse = {
    ok: true,
    request,
    analysis: analyzePage(request),
  };

  return c.json(response);
});

serve({ fetch: app.fetch, port: apiPort }, (info) => {
  console.log(
    `[verity/api] listening on http://127.0.0.1:${info.port} (CORS: ${allowedOrigins.join(", ")})`,
  );
});
