import Image from "next/image";
import { PACKAGES_WORKSPACE } from "@packages/core";

async function getApiHealth(): Promise<{ ok: boolean } | null> {
  const origin =
    process.env.API_ORIGIN ??
    process.env.NEXT_PUBLIC_API_ORIGIN ??
    "http://127.0.0.1:3001";
  try {
    const res = await fetch(`${origin.replace(/\/$/, "")}/health`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getApiHealth();

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Shared workspace:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {PACKAGES_WORKSPACE}
            </code>
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            API{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              /health
            </code>
            :{" "}
            {health?.ok ? (
              <span className="text-emerald-600 dark:text-emerald-400">reachable</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                not reachable (run{" "}
                <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">
                  bun run dev:api
                </code>
                )
              </span>
            )}
          </p>
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Frontend lives in{" "}
            <code className="text-lg">packages/web</code>, API in{" "}
            <code className="text-lg">packages/api</code>.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Domain types and shared logic belong in{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              @packages/core
            </code>
            .
          </p>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <a
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={16}
              height={16}
            />
            Deploy Now
          </a>
          <a
            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </div>
      </main>
    </div>
  );
}
