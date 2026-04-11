import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  API_DEFAULT_PORT,
  PACKAGES_WORKSPACE,
  type HealthResponse,
} from "@packages/core";

function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return ["http://localhost:3000", "http://127.0.0.1:3000"];
  }
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

const apiPort = Number(process.env.API_PORT ?? process.env.PORT) || API_DEFAULT_PORT;
const webPort = process.env.WEB_PORT;
if (webPort != null && String(apiPort) === String(webPort)) {
  console.error(
    "[@packages/api] WEB_PORT and API_PORT must differ (both are %s). Fix your .env.",
    apiPort,
  );
  process.exit(1);
}

const app = new Hono();

const allowedOrigins = parseCorsOrigins(process.env.WEB_ORIGIN);

app.use(
  "/*",
  cors({
    origin: allowedOrigins,
  }),
);

app.get("/health", (c) => {
  const body: HealthResponse = {
    ok: true,
    workspace: PACKAGES_WORKSPACE,
    service: "api",
  };
  return c.json(body);
});

serve({ fetch: app.fetch, port: apiPort }, (info) => {
  console.log(
    `[@packages/api] listening on http://127.0.0.1:${info.port} (CORS: ${allowedOrigins.join(", ")})`,
  );
});
