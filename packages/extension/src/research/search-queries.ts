/**
 * Derive a diverse set of search queries from page content or a user question.
 *
 * The goal is *source diversity*: traditional news, social discussion, video,
 * and region-specific angles — so Gemini can synthesize from a wider evidence
 * base rather than echoing the same top-10 blue-link outlets.
 */

export function deriveSearchQueries(page: {
  title: string | null;
  contentText: string;
}): string[] {
  const queries: string[] = [];
  const topic = page.title?.replace(/\s*[-|].+$/, "").trim() ?? "";

  if (!topic && !page.contentText) {
    return ["news today"];
  }

  const snippet = page.contentText.slice(0, 500);
  const keyPhrase = extractKeyPhrase(snippet);
  const base = topic || keyPhrase || snippet.slice(0, 60).trim();

  // 1. Core topic query
  if (topic) {
    queries.push(topic);
  }

  // 2. Key-phrase variant (avoids duplicate if same as topic)
  if (keyPhrase && keyPhrase !== topic) {
    queries.push(keyPhrase);
  }

  // 3. Fact-check / verification
  if (base) {
    queries.push(`${base} fact check`);
  }

  // 4. Opposing / critical perspective
  if (base) {
    queries.push(`${base} opposing view OR criticism`);
  }

  // 5. Social / discussion perspective (Reddit, forums, X/Twitter)
  if (base) {
    queries.push(`${base} site:reddit.com OR site:news.ycombinator.com`);
  }

  // 6. Video coverage (YouTube, news clips)
  if (base) {
    queries.push(`${base} site:youtube.com`);
  }

  // 7. Region-specific angle — if we can detect a geographic signal
  const region = detectRegion(page.contentText);
  if (region && base) {
    queries.push(`${base} ${region} local news`);
  }

  // 8. Named-entity variant
  const entities = extractEntities(page.contentText);
  if (entities && entities !== topic && entities !== keyPhrase) {
    queries.push(entities);
  }

  const unique = [...new Set(queries.filter((q) => q.length > 2))];
  // Allow up to 8 queries now (was 5) since we want broader coverage.
  // The orchestrator's SERP + page limits still bound total tab count.
  return unique.slice(0, 8);
}

function extractKeyPhrase(text: string): string | null {
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.length > 20);
  if (sentences.length === 0) return null;
  const first = sentences[0].replace(/\s+/g, " ").trim();
  return first.length > 80 ? first.slice(0, 80).trim() : first;
}

function extractEntities(text: string): string | null {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g);
  if (!matches || matches.length === 0) return null;

  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match, (counts.get(match) ?? 0) + 1);
  }

  let best = "";
  let bestCount = 0;
  for (const [entity, count] of counts) {
    if (count > bestCount) {
      best = entity;
      bestCount = count;
    }
  }

  return best || null;
}

/**
 * Lightweight region detection from content text.
 * Looks for country/city names that appear frequently enough to suggest
 * the story has a geographic focus worth querying for local coverage.
 */
const REGION_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:London|UK|Britain|British|England|Scotland|Wales)\b/gi, label: "UK" },
  { pattern: /\b(?:Washington|Congress|Capitol Hill|White House|Senate|US|United States|American)\b/gi, label: "US" },
  { pattern: /\b(?:Delhi|Mumbai|India|Indian|Modi|BJP)\b/gi, label: "India" },
  { pattern: /\b(?:Beijing|Shanghai|China|Chinese|CCP)\b/gi, label: "China" },
  { pattern: /\b(?:Tokyo|Japan|Japanese)\b/gi, label: "Japan" },
  { pattern: /\b(?:Sydney|Melbourne|Australia|Australian)\b/gi, label: "Australia" },
  { pattern: /\b(?:Paris|France|French|Macron)\b/gi, label: "France" },
  { pattern: /\b(?:Berlin|Germany|German|Bundestag)\b/gi, label: "Germany" },
  { pattern: /\b(?:Moscow|Russia|Russian|Kremlin|Putin)\b/gi, label: "Russia" },
  { pattern: /\b(?:Kyiv|Ukraine|Ukrainian|Zelensky)\b/gi, label: "Ukraine" },
  { pattern: /\b(?:Brazil|Brazilian|Brasilia|Lula)\b/gi, label: "Brazil" },
  { pattern: /\b(?:Nigeria|Nigerian|Lagos|Abuja)\b/gi, label: "Nigeria" },
  { pattern: /\b(?:Kenya|Kenyan|Nairobi)\b/gi, label: "Kenya" },
  { pattern: /\b(?:South Africa|Johannesburg|Cape Town)\b/gi, label: "South Africa" },
  { pattern: /\b(?:Israel|Israeli|Tel Aviv|Jerusalem|Gaza|Palestinian)\b/gi, label: "Middle East" },
  { pattern: /\b(?:Dubai|UAE|Saudi|Riyadh)\b/gi, label: "Middle East" },
  { pattern: /\b(?:Toronto|Canada|Canadian|Ottawa)\b/gi, label: "Canada" },
  { pattern: /\b(?:Seoul|South Korea|Korean)\b/gi, label: "South Korea" },
  { pattern: /\b(?:Singapore|Singaporean)\b/gi, label: "Singapore" },
  { pattern: /\b(?:EU|European Union|Brussels|Strasbourg)\b/gi, label: "Europe" },
];

function detectRegion(text: string): string | null {
  const sample = text.slice(0, 2000);
  let bestLabel: string | null = null;
  let bestCount = 0;

  for (const { pattern, label } of REGION_SIGNALS) {
    const matches = sample.match(pattern);
    const count = matches?.length ?? 0;
    if (count >= 2 && count > bestCount) {
      bestLabel = label;
      bestCount = count;
    }
  }

  return bestLabel;
}
