/** Shared workspace package — domain types, schemas, and clients live here. */
export const PACKAGES_WORKSPACE = "@packages/core" as const;

/** Default HTTP port for `@packages/api` if `API_PORT` / `PORT` are unset (see repo-root `.env`). */
export const API_DEFAULT_PORT = 3001 as const;

export type HealthResponse = {
  ok: boolean;
  workspace: string;
  service: "api";
};
