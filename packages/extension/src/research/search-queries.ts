/**
 * Derive a focused set of search queries from page content or a user question.
 *
 * The goal is to preserve source diversity without drifting off-subject.
 */

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

const ANALYTICAL_TERMS = new Set([
  "analyse",
  "analysis",
  "analyze",
  "article",
  "background",
  "bias",
  "biased",
  "check",
  "claim",
  "compare",
  "contrast",
  "counterargument",
  "credibility",
  "debunk",
  "evidence",
  "fact",
  "framing",
  "investigate",
  "look",
  "missing",
  "news",
  "opinion",
  "perspective",
  "real",
  "report",
  "research",
  "reliable",
  "source",
  "sources",
  "story",
  "true",
  "verify",
  "view",
]);

export function deriveSearchQueries(page: {
  title: string | null;
  contentText: string;
}): string[] {
  const queries: string[] = [];
  const topic = normalizeTopic(page.title);

  if (!topic && !page.contentText) {
    return ["news today"];
  }

  const snippet = page.contentText.slice(0, 500);
  const keyPhrase = extractKeyPhrase(snippet);
  const entityPhrase = extractEntities(page.contentText);
  const subject = pickBestSubject(topic, keyPhrase, entityPhrase, page.contentText);
  const base = subject || topic || keyPhrase || snippet.slice(0, 60).trim();
  const subjectTokens = tokenizeForRelevance(base);
  const hasStrongSubject =
    subjectTokens.length >= 2 || /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(base);

  if (base) {
    queries.push(base);
  }

  if (topic && topic !== base) {
    queries.push(topic);
  }

  if (keyPhrase && keyPhrase !== topic && keyPhrase !== base) {
    queries.push(keyPhrase);
  }

  if (base && hasStrongSubject) {
    queries.push(`${base} fact check`);
    queries.push(`${base} opposing view OR criticism`);
    queries.push(`${base} site:reddit.com OR site:news.ycombinator.com`);
    queries.push(`${base} site:youtube.com`);
  }

  const region = detectRegion(page.contentText);
  if (region && base && hasStrongSubject) {
    queries.push(`${base} ${region} local news`);
  }

  if (entityPhrase && entityPhrase !== topic && entityPhrase !== keyPhrase && entityPhrase !== base) {
    queries.push(entityPhrase);
  }

  const unique = [...new Set(queries.map((q) => q.trim()).filter((q) => q.length > 2))];
  return unique.slice(0, hasStrongSubject ? 6 : 3);
}

function extractKeyPhrase(text: string): string | null {
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.length > 20);
  if (sentences.length === 0) return null;

  const candidate = sentences
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .map((sentence) => stripAnalyticalLeadIn(sentence))
    .find((sentence) => tokenizeForRelevance(sentence).length >= 2);

  if (!candidate) return null;
  return candidate.length > 90 ? candidate.slice(0, 90).trim() : candidate;
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

function normalizeTopic(title: string | null): string {
  if (!title) return "";
  const stripped = title.replace(/\s*[-|:]\s+[^-|:]+$/, "").replace(/\s+/g, " ").trim();
  return stripAnalyticalLeadIn(stripped);
}

function stripAnalyticalLeadIn(text: string): string {
  return text
    .replace(/^(?:can you|could you|please|look into|research|analyse|analyze|fact check|verify|check)\s+/i, "")
    .replace(/\?+$/, "")
    .trim();
}

function pickBestSubject(
  topic: string,
  keyPhrase: string | null,
  entityPhrase: string | null,
  contentText: string,
): string {
  const candidates = [topic, entityPhrase ?? "", keyPhrase ?? "", contentText.slice(0, 120)]
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (tokenizeForRelevance(candidate).length >= 2) {
      return candidate;
    }
  }

  return candidates[0] ?? "";
}

export function tokenizeForRelevance(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 3 && !STOP_WORDS.has(token) && !ANALYTICAL_TERMS.has(token),
  );
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
