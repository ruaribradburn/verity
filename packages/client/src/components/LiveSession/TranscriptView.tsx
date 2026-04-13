"use client";

import type { LiveInlineCard, TranscriptEntry } from "../../LiveVoiceSession";

type TranscriptViewProps = {
  transcript: TranscriptEntry[];
  inlineCard: LiveInlineCard | null;
  partialUserTranscript: string;
  partialAssistantTranscript: string;
};

export function TranscriptView({
  transcript,
  inlineCard,
  partialUserTranscript,
  partialAssistantTranscript,
}: TranscriptViewProps) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {transcript.map((entry) => (
        <TranscriptEntryView key={entry.id} entry={entry} />
      ))}

      {inlineCard ? <InlineTranscriptCard key={inlineCard.id} card={inlineCard} /> : null}

      {partialUserTranscript.trim() ? (
        <TranscriptEntryView
          entry={{
            id: "live-user",
            role: "user",
            text: partialUserTranscript,
            meta: "speaking",
          }}
        />
      ) : null}

      {partialAssistantTranscript.trim() ? (
        <TranscriptEntryView
          entry={{
            id: "live-assistant",
            role: "assistant",
            text: partialAssistantTranscript,
            meta: "responding",
          }}
        />
      ) : null}
    </div>
  );
}

function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  const isSystem = entry.role === "system";
  const isUser = entry.role === "user";

  const bubbleClass = isSystem
    ? "bg-[var(--background-surface)] text-[var(--foreground-secondary)] border border-[var(--border)]"
    : isUser
      ? "bg-[var(--user-bg)] text-[var(--user-text)] border border-[var(--user-border)]"
      : "bg-[var(--assistant-bg)] text-[var(--assistant-text)] border border-[var(--assistant-border)]";

  const alignment = isUser ? "ml-auto" : "mr-auto";

  return (
    <article className={`max-w-[88%] rounded-2xl px-4 py-3 ${bubbleClass} ${alignment}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium capitalize opacity-70">
          {entry.role === "assistant" ? "verity" : entry.role}
        </span>
        {entry.meta ? <span className="text-[10px] opacity-50">{entry.meta}</span> : null}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{entry.text}</p>
    </article>
  );
}

function InlineTranscriptCard({ card }: { card: LiveInlineCard }) {
  const toneStyles =
    card.tone === "success"
      ? { accent: "var(--success)", accentMuted: "var(--success-muted)", text: "var(--success)" }
      : card.tone === "error"
        ? { accent: "var(--error)", accentMuted: "var(--error-muted)", text: "var(--error)" }
        : { accent: "var(--accent)", accentMuted: "var(--accent-muted)", text: "var(--accent-text)" };

  const progress =
    card.totalPages && card.totalPages > 0
      ? Math.max(6, Math.min(100, Math.round(((card.pagesRead ?? 0) / card.totalPages) * 100)))
      : null;

  return (
    <article
      className="mr-auto max-w-[88%] overflow-hidden rounded-2xl border border-[var(--border)]"
      style={{
        background: `linear-gradient(135deg, ${toneStyles.accentMuted}, var(--background-surface))`,
      }}
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: toneStyles.text }}
            >
              {card.label}
            </p>
            <p className="mt-1 text-[13px] font-medium text-[var(--foreground)]">{card.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--foreground-secondary)]">
              {card.status}
            </p>
          </div>
          {card.metrics?.length ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {card.metrics.map((metric) => (
                <span
                  key={metric.label}
                  className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] text-[var(--foreground-secondary)]"
                >
                  {metric.label}: {metric.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {card.query ? (
          <div className="mt-3 rounded-lg bg-[var(--background)] px-3 py-2">
            <p className="text-[12px] leading-relaxed text-[var(--foreground-secondary)]">
              {card.query}
            </p>
          </div>
        ) : null}
      </div>

      {progress !== null ? (
        <div className="h-1 bg-[var(--background)]">
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${progress}%`, background: toneStyles.accent }}
          />
        </div>
      ) : null}

      {card.items?.length ? (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] px-4 py-2.5">
          {card.items.map((item, index) => (
            <span
              key={`${card.id}-${index}-${item}`}
              className="inline-flex items-center rounded-full bg-[var(--background)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
