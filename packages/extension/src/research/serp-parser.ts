export function extractSerpResults(): Array<{ url: string; title: string }> {
  const MAX_RESULTS = 8;
  const results: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  const container =
    document.querySelector("#rso") ??
    document.querySelector("#search") ??
    document.body;

  const links = container.querySelectorAll<HTMLAnchorElement>("a[href]");

  for (const link of links) {
    if (results.length >= MAX_RESULTS) break;

    const href = link.href;
    if (!href || !href.startsWith("http")) continue;

    try {
      const u = new URL(href);
      if (u.hostname.includes("google.com")) continue;
      if (u.hostname.includes("googleapis.com")) continue;
      if (u.hostname.includes("gstatic.com")) continue;
      if (u.hostname.includes("youtube.com") && u.pathname === "/") continue;
    } catch {
      continue;
    }

    const key = new URL(href).origin + new URL(href).pathname;
    if (seen.has(key)) continue;
    seen.add(key);

    const heading = link.querySelector("h3");
    const title = (heading?.textContent ?? link.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();

    if (!title) continue;

    results.push({ url: href, title });
  }

  return results;
}
