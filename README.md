Verity is a **Bun workspaces** monorepo. Shared types and domain logic live in **`packages/core`**. The **Next.js** app is **`packages/web`**; the **HTTP API** (Hono) is **`packages/api`**. **Ports and URLs are configured in the repo-root `.env`** (see `.env.example`).

## Getting started

Install dependencies from the repo root, then start web and API together:

```bash
bun install
bun run dev
```

`bun run dev` runs **`scripts/kill-dev-ports.ts`** first: it stops anything already listening on **`WEB_PORT`** and **`API_PORT`** (from `.env`), then starts web + API. Use `bun run kill-dev-ports` alone if you only want to free those ports.

- Web: default **http://localhost:3000** (override with **`WEB_PORT`** in `.env`)
- API health: default **http://127.0.0.1:3001/health** (override **`API_PORT`** / **`API_ORIGIN`**)

Run only the web or API:

```bash
bun run dev:web
bun run dev:api
```

### Environment

- Copy **`.env.example`** → **`.env`** at the repo root (never commit `.env`).
- **`WEB_PORT`** / **`API_PORT`**: must be two different ports; `bun run dev` uses **`dotenv-cli`** so both processes read the same file.
- **`WEB_ORIGIN`**: comma-separated browser origins allowed by the API (**CORS**). No trailing slashes.
- **`API_ORIGIN`**: base URL the Next server uses for server-side `fetch` (not `NEXT_PUBLIC_*`).
- **`NEXT_PUBLIC_API_ORIGIN`**: only if the browser calls the API directly; omit or use a public URL in production when possible.

`packages/web/next.config.mjs` loads the **repo-root** `.env` so server code and builds see the same values as the API.

Edit the home page at `packages/web/app/page.tsx`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
