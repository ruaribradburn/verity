// packages/extension/src/research/extractor.ts

/**
 * Injected into a tab via chrome.scripting.executeScript.
 * Must be fully self-contained — no imports, no closures.
 * Returns a PageContext-shaped object.
 */
export function extractPageContent(): {
  url: string;
  title: string | null;
  siteName: string | null;
  publishedAt: string | null;
  contentText: string;
  selectionText: string | null;
} {
  const MAX_LENGTH = 10_000;

  const url = location.href;
  const title = document.title || null;

  // Site name
  const ogSiteName = document.querySelector<HTMLMetaElement>(
    'meta[property="og:site_name"]',
  );
  let siteName: string | null = ogSiteName?.content ?? null;
  if (!siteName) {
    try {
      siteName = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      siteName = null;
    }
  }

  // Published date
  const publishedAt =
    document.querySelector<HTMLMetaElement>(
      'meta[property="article:published_time"]',
    )?.content ??
    document.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime ??
    document.querySelector<HTMLMetaElement>('meta[name="date"]')?.content ??
    null;

  // Content extraction
  const STRIP_SELECTORS = [
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    "aside",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[class*="ad-"]',
    '[class*="sidebar"]',
    '[class*="related-posts"]',
    '[class*="cookie"]',
    '[class*="popup"]',
    '[id*="ad-"]',
    '[id*="sidebar"]',
  ].join(",");

  // Find the best content root
  const contentRoot =
    document.querySelector("article") ??
    document.querySelector('[role="main"]') ??
    document.querySelector("main") ??
    document.body;

  // Clone so we don't mutate the live DOM
  const clone = contentRoot.cloneNode(true) as HTMLElement;

  // Strip unwanted elements
  clone.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());

  // Get text and normalize whitespace
  let contentText = (clone.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (contentText.length > MAX_LENGTH) {
    contentText = contentText.slice(0, MAX_LENGTH);
  }

  return {
    url,
    title,
    siteName,
    publishedAt,
    contentText,
    selectionText: null,
  };
}
