import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { GoogleGenAI, Modality } from "@google/genai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  API_DEFAULT_PORT,
  APP_WORKSPACE,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  analyzePage,
  buildPageContext,
  createFixtureRequests,
  createLiveConfigSummary,
  resolveGeminiApiKey,
  runFixtureAssertions,
  type PageHydrationHttpRequest,
  type PageHydrationHttpResponse,
  type AnalysisRequest,
  type AnalyzeHttpResponse,
  type HealthResponse,
  type LiveConfigHttpResponse,
  type LiveTokenHttpResponse,
} from "@packages/core";

const URL_RESOLUTION_MODEL = "gemini-2.5-flash";
const TRAFILATURA_SCRIPT_PATH = fileURLToPath(new URL("../../../scripts/trafilatura_extract.py", import.meta.url));

/**
 * Repo-root `.venv` from `bun run setup:trafilatura` (recommended on macOS Homebrew Python).
 * `run-workspace` sets cwd to `packages/api`, so repo root is two levels up.
 */
function trafilaturaRepoRootVenvPython(): string | null {
  const root = path.resolve(process.cwd(), "../..");
  if (process.platform === "win32") {
    const exe = path.join(root, ".venv", "Scripts", "python.exe");
    return existsSync(exe) ? exe : null;
  }
  const py3 = path.join(root, ".venv", "bin", "python3");
  const py = path.join(root, ".venv", "bin", "python");
  if (existsSync(py3)) return py3;
  if (existsSync(py)) return py;
  return null;
}

/**
 * Interpreters to try for `trafilatura_extract.py` when `PYTHON_BIN` is unset.
 * Prefers `.venv` when present, then system names (macOS/Linux: python3, python; Windows: python, python3).
 */
function trafilaturaPythonCandidates(): string[] {
  const override = process.env.PYTHON_BIN?.trim();
  if (override) return [override];
  const venvPy = trafilaturaRepoRootVenvPython();
  const rest = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  return venvPy ? [venvPy, ...rest] : rest;
}

function isSpawnExecutableMissing(error: unknown): boolean {
  const e = error as NodeJS.ErrnoException & { code?: string };
  if (e?.code === "ENOENT") return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /not found|ENOENT|spawn .* ENOENT/i.test(msg);
}

type ScreenResolution = {
  url: string | null;
  title: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

type TrafilaturaResult =
  | {
      ok: true;
      url: string;
      title: string | null;
      siteName: string | null;
      publishedAt: string | null;
      contentText: string;
    }
  | {
      ok: false;
      error: string;
    };

function formatGeminiCredentialError(error: unknown) {
  const fallback = error instanceof Error ? error.message : "Failed to create ephemeral token.";
  const normalized = fallback.toLowerCase();

  if (
    normalized.includes("api_key_invalid") ||
    normalized.includes("api key not valid") ||
    normalized.includes("invalid api key")
  ) {
    return (
      "Configured GEMINI_API_KEY is invalid. Set a valid Google AI Studio Gemini API key in .env " +
      "and restart the API server."
    );
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("permission_denied") ||
    normalized.includes("forbidden")
  ) {
    return (
      "Configured GEMINI_API_KEY does not have permission to create Gemini Live tokens. " +
      "Use a Google AI Studio key with Gemini API access and restart the API server."
    );
  }

  return fallback;
}

function parseCorsOrigins(raw: string | undefined): string[] {
  const origins = !raw?.trim()
    ? ["http://localhost:3000", "http://127.0.0.1:3000"]
    : raw
        .split(",")
        .map((value) => value.trim().replace(/\/$/, ""))
        .filter(Boolean);

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

function normalizeHttpUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;

  try {
    const normalized = new URL(value.trim());
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }
    return normalized.toString();
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseResolutionPayload(raw: string) {
  try {
    return JSON.parse(raw) as Partial<ScreenResolution>;
  } catch {
    return null;
  }
}

async function resolvePageFromScreen(params: {
  apiKey: string;
  screenshotBase64: string;
  hintedTitle?: string | null;
}): Promise<ScreenResolution> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const response = await ai.models.generateContent({
    model: URL_RESOLUTION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "You are extracting the current webpage from a browser screenshot. " +
              "Return strict JSON with keys url, title, confidence, rationale. " +
              "Prefer the address bar URL if visible. Only return a URL when it is clearly readable and looks like a web page. " +
              `If the title is visible, include it. Hinted title: ${params.hintedTitle ?? "none"}.`,
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: params.screenshotBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  });

  const parsed = parseResolutionPayload(response.text ?? "");
  const confidence =
    parsed?.confidence === "high" || parsed?.confidence === "medium" || parsed?.confidence === "low"
      ? parsed.confidence
      : "low";

  return {
    url: normalizeHttpUrl(parsed?.url),
    title: normalizeOptionalText(parsed?.title),
    confidence,
    rationale: normalizeOptionalText(parsed?.rationale) ?? "No rationale returned.",
  };
}

function runTrafilaturaWithPython(python: string, url: string): Promise<TrafilaturaResult> {
  return new Promise<TrafilaturaResult>((resolve, reject) => {
    const child = spawn(python, [TRAFILATURA_SCRIPT_PATH, url], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout || "{}") as TrafilaturaResult;
        if ("ok" in parsed) {
          resolve(parsed);
          return;
        }
      } catch {
        // fall through to structured error below
      }

      resolve({
        ok: false,
        error: normalizeOptionalText(stderr) ?? "Trafilatura extraction failed.",
      });
    });
  });
}

async function runTrafilatura(url: string): Promise<TrafilaturaResult> {
  const candidates = trafilaturaPythonCandidates();
  let lastSpawnError: Error | undefined;

  for (let i = 0; i < candidates.length; i += 1) {
    const python = candidates[i]!;
    try {
      return await runTrafilaturaWithPython(python, url);
    } catch (error) {
      if (isSpawnExecutableMissing(error) && i < candidates.length - 1) {
        lastSpawnError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    }
  }

  throw lastSpawnError ?? new Error("No Python interpreter found for trafilatura.");
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
      // Chrome extensions call the local API with Origin: chrome-extension://<id>
      if (origin.startsWith("chrome-extension://")) {
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
  if (!geminiApiKey) {
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
            temperature: 0.7,
          },
        },
      },
    });

    if (!token.name) {
      throw new Error("Gemini did not return an ephemeral token name.");
    }

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
    const body: LiveTokenHttpResponse = {
      ok: false,
      authMode: "unavailable",
      error: formatGeminiCredentialError(error),
      warnings: [
        "The server-side Gemini credential is present, but token creation failed.",
        "Check GEMINI_API_KEY in .env and restart the API server after updating it.",
      ],
    };
    return c.json(body, 500);
  }
});

app.post("/page/context", async (c) => {
  let payload: PageHydrationHttpRequest;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body.", warnings: [] } satisfies PageHydrationHttpResponse, 400);
  }

  const warnings: string[] = [];
  const hintedUrl = normalizeHttpUrl(payload.hintedUrl);
  const hintedTitle = normalizeOptionalText(payload.hintedTitle);
  const selectionText = normalizeOptionalText(payload.selectionText);

  let source: "hint" | "screen" = "hint";
  let resolvedUrl = hintedUrl;
  let resolvedTitle = hintedTitle;

  if (!resolvedUrl) {
    if (!payload.screenshotBase64?.trim()) {
      return c.json(
        {
          ok: false,
          error: "A screenshot or hinted URL is required to resolve the current page.",
          warnings,
        } satisfies PageHydrationHttpResponse,
        400,
      );
    }

    if (!geminiApiKey) {
      return c.json(
        {
          ok: false,
          error: "Cannot resolve the current page from screen share without a server-side GEMINI_API_KEY.",
          warnings,
        } satisfies PageHydrationHttpResponse,
        503,
      );
    }

    const resolved = await resolvePageFromScreen({
      apiKey: geminiApiKey,
      screenshotBase64: payload.screenshotBase64,
      hintedTitle,
    });

    resolvedUrl = resolved.url;
    resolvedTitle = resolved.title ?? hintedTitle;
    source = "screen";

    if (resolved.confidence !== "high") {
      warnings.push(`Screen URL resolution confidence was ${resolved.confidence}: ${resolved.rationale}`);
    }
  }

  if (!resolvedUrl) {
    return c.json(
      {
        ok: false,
        error: "Could not resolve a valid http(s) page URL from the current screen.",
        warnings,
      } satisfies PageHydrationHttpResponse,
      422,
    );
  }

  let extraction: TrafilaturaResult;
  try {
    extraction = await runTrafilatura(resolvedUrl);
  } catch (error) {
    const base = error instanceof Error ? error.message : "Failed to invoke trafilatura.";
    const hint =
      /ENOENT|not found|spawn/i.test(base) || /PATH/i.test(base)
        ? " Install Python 3 and run: python3 -m pip install trafilatura (on Windows often: python -m pip install trafilatura). Set PYTHON_BIN in .env if needed."
        : "";
    return c.json(
      {
        ok: false,
        error: base + hint,
        warnings,
      } satisfies PageHydrationHttpResponse,
      500,
    );
  }

  if (!extraction.ok) {
    return c.json(
      {
        ok: false,
        error: extraction.error,
        warnings,
      } satisfies PageHydrationHttpResponse,
      502,
    );
  }

  const page = buildPageContext({
    url: extraction.url,
    title: extraction.title ?? resolvedTitle,
    siteName: extraction.siteName,
    publishedAt: extraction.publishedAt,
    contentText: extraction.contentText,
    selectionText,
  });

  if (!page.contentText.trim()) {
    return c.json(
      {
        ok: false,
        error: "Trafilatura did not return any readable page text for the resolved URL.",
        warnings,
      } satisfies PageHydrationHttpResponse,
      502,
    );
  }

  return c.json({
    ok: true,
    source,
    resolvedUrl: extraction.url,
    page,
    warnings,
  } satisfies PageHydrationHttpResponse);
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
  const order = trafilaturaPythonCandidates().join(" → ");
  console.log(
    `[verity/api] listening on http://127.0.0.1:${info.port} (CORS: ${allowedOrigins.join(", ")})`,
  );
  console.log(`[verity/api] trafilatura will try Python in order: ${order} (set PYTHON_BIN to use one path only)`);
});
