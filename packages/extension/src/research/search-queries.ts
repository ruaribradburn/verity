export function deriveSearchQueries(page: {
  title: string | null;
  contentText: string;
}): string[] {
  const queries: string[] = [];
  const topic = page.title?.replace(/\s*[-|].+$/, "").trim() ?? "";

  if (!topic && !page.contentText) {
    return ["news today"];
  }

  if (topic) {
    queries.push(topic);
  }

  const snippet = page.contentText.slice(0, 500);
  const keyPhrase = extractKeyPhrase(snippet);
  if (keyPhrase && keyPhrase !== topic) {
    queries.push(keyPhrase);
  }

  const base = topic || keyPhrase || snippet.slice(0, 60).trim();
  if (base) {
    queries.push(`${base} fact check`);
  }

  if (base) {
    queries.push(`${base} opposing view OR criticism`);
  }

  const entities = extractEntities(page.contentText);
  if (entities && entities !== topic && entities !== keyPhrase) {
    queries.push(entities);
  }

  const unique = [...new Set(queries.filter((q) => q.length > 2))];
  return unique.slice(0, 5);
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
