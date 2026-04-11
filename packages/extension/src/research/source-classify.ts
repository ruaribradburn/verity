/**
 * Lightweight source-type classifier for research results.
 *
 * Annotates each collected source so Gemini can weigh evidence appropriately —
 * a wire service report vs a Reddit thread vs a YouTube commentary carry
 * different epistemic weight. This is intentionally hostname-based and
 * coarse-grained; it does not try to be an exhaustive media database.
 */

export type SourceType =
  | "wire-service"
  | "broadsheet"
  | "tabloid"
  | "public-broadcaster"
  | "business-financial"
  | "magazine-analysis"
  | "state-affiliated"
  | "social-discussion"
  | "video"
  | "fact-checker"
  | "regional-local"
  | "news-outlet"
  | "unknown";

type SourceMeta = {
  type: SourceType;
  label: string;
};

const HOSTNAME_RULES: Array<{ match: RegExp; type: SourceType; label: string }> = [
  // Wire services
  { match: /reuters\.com$/, type: "wire-service", label: "Wire service" },
  { match: /apnews\.com$/, type: "wire-service", label: "Wire service" },
  { match: /aa\.com\.tr$/, type: "wire-service", label: "Wire service" },
  { match: /kyodonews\.net$/, type: "wire-service", label: "Wire service" },

  // Fact-checkers
  { match: /snopes\.com$/, type: "fact-checker", label: "Fact-checker" },
  { match: /factcheck\.org$/, type: "fact-checker", label: "Fact-checker" },
  { match: /politifact\.com$/, type: "fact-checker", label: "Fact-checker" },
  { match: /fullfact\.org$/, type: "fact-checker", label: "Fact-checker" },
  { match: /boomlive\.in$/, type: "fact-checker", label: "Fact-checker" },

  // Public broadcasters
  { match: /bbc\.com$|bbc\.co\.uk$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /pbs\.org$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /abc\.net\.au$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /cbc\.ca$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /nhk\.or\.jp$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /dw\.com$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /france24\.com$/, type: "public-broadcaster", label: "Public broadcaster" },
  { match: /yle\.fi$/, type: "public-broadcaster", label: "Public broadcaster" },

  // Business / financial
  { match: /ft\.com$/, type: "business-financial", label: "Business/financial" },
  { match: /wsj\.com$/, type: "business-financial", label: "Business/financial" },
  { match: /bloomberg\.com$/, type: "business-financial", label: "Business/financial" },
  { match: /cnbc\.com$/, type: "business-financial", label: "Business/financial" },
  { match: /economist\.com$/, type: "business-financial", label: "Business/financial" },

  // Magazine / long-form analysis
  { match: /theatlantic\.com$/, type: "magazine-analysis", label: "Magazine/analysis" },
  { match: /newyorker\.com$/, type: "magazine-analysis", label: "Magazine/analysis" },
  { match: /newstatesman\.com$/, type: "magazine-analysis", label: "Magazine/analysis" },
  { match: /spectator\.co\.uk$/, type: "magazine-analysis", label: "Magazine/analysis" },
  { match: /prospect.*\.co\.uk$/, type: "magazine-analysis", label: "Magazine/analysis" },
  { match: /vox\.com$/, type: "magazine-analysis", label: "Explainer/analysis" },
  { match: /axios\.com$/, type: "magazine-analysis", label: "Explainer/analysis" },

  // Tabloid / sensational
  { match: /dailymail\.co\.uk$/, type: "tabloid", label: "Tabloid" },
  { match: /nypost\.com$/, type: "tabloid", label: "Tabloid" },
  { match: /thesun\.co\.uk$/, type: "tabloid", label: "Tabloid" },
  { match: /mirror\.co\.uk$/, type: "tabloid", label: "Tabloid" },

  // State-affiliated
  { match: /rt\.com$/, type: "state-affiliated", label: "State-affiliated media" },
  { match: /tass\.com$/, type: "state-affiliated", label: "State-affiliated media" },
  { match: /xinhua.*\.com$/, type: "state-affiliated", label: "State-affiliated media" },
  { match: /globaltimes\.cn$/, type: "state-affiliated", label: "State-affiliated media" },
  { match: /presstv\.ir$/, type: "state-affiliated", label: "State-affiliated media" },

  // Social / discussion
  { match: /reddit\.com$/, type: "social-discussion", label: "Social discussion" },
  { match: /news\.ycombinator\.com$/, type: "social-discussion", label: "Social discussion" },
  { match: /twitter\.com$|x\.com$/, type: "social-discussion", label: "Social media" },
  { match: /threads\.net$/, type: "social-discussion", label: "Social media" },
  { match: /quora\.com$/, type: "social-discussion", label: "Q&A platform" },

  // Video
  { match: /youtube\.com$|youtu\.be$/, type: "video", label: "Video" },
  { match: /tiktok\.com$/, type: "video", label: "Short-form video" },
];

export function classifySource(url: string): SourceMeta {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { type: "unknown", label: "Unknown" };
  }

  for (const rule of HOSTNAME_RULES) {
    if (rule.match.test(hostname)) {
      return { type: rule.type, label: rule.label };
    }
  }

  // Heuristic fallback: well-known TLDs for news
  if (/\.gov($|\.)/.test(hostname)) {
    return { type: "regional-local", label: "Government source" };
  }
  if (/\.edu($|\.)/.test(hostname) || /\.ac\./.test(hostname)) {
    return { type: "regional-local", label: "Academic source" };
  }

  return { type: "news-outlet", label: "News outlet" };
}

/**
 * Format a one-line source tag for Gemini context injection.
 * e.g. "[Source 3: Climate bill faces Senate vote — Reuters | Wire service]"
 */
export function formatSourceTag(
  index: number,
  title: string | null,
  url: string,
  siteName: string | null,
): string {
  const meta = classifySource(url);
  const host = siteName ?? tryHostname(url);
  const titleStr = title ?? "Untitled";
  return `[Source ${index + 1}: ${titleStr} — ${host} | ${meta.label}]`;
}

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
