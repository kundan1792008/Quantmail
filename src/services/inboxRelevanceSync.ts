type InboxLikeMessage = {
  id: string;
  senderEmail: string;
  subject: string;
  body: string;
  receivedAt: Date;
};

type WatchEventLike = {
  videoTitle: string;
  watchedSeconds: number;
  watchedAt: Date;
};

type RelevanceSyncInfo = {
  promoted: boolean;
  matchedKeyword: string | null;
  matchedVideoTitle: string | null;
  presentation: {
    pinToTop: boolean;
    borderStyle: "standard" | "glowing-holographic";
  };
};

const PROMOTIONAL_PATTERNS = [
  /\bpromo(?:tional)?\b/i,
  /\bdiscount\b/i,
  /\bdeal\b/i,
  /\boffer\b/i,
  /\bsale\b/i,
  /\bbuy now\b/i,
  /\blimited time\b/i,
  /\bshop now\b/i,
  /\bexclusive\b/i,
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "and",
  "for",
  "from",
  "have",
  "just",
  "more",
  "that",
  "the",
  "this",
  "today",
  "video",
  "watch",
  "with",
  "your",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isPromotionalEmail(message: {
  senderEmail: string;
  subject: string;
  body: string;
}): boolean {
  const haystack = `${message.senderEmail} ${message.subject} ${message.body}`;
  return PROMOTIONAL_PATTERNS.some((pattern) => pattern.test(haystack));
}

function extractVideoKeywords(videoTitle: string): string[] {
  return Array.from(
    new Set(
      videoTitle
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    )
  );
}

export function findMatchingQuanttubeKeyword(
  message: { subject: string; body: string },
  watchEvents: WatchEventLike[],
  now: Date = new Date()
): { matchedKeyword: string | null; matchedVideoTitle: string | null } {
  const todayStart = startOfDay(now).getTime();
  const haystack = `${message.subject} ${message.body}`.toLowerCase();

  for (const event of watchEvents) {
    if (event.watchedSeconds <= 45) {
      continue;
    }

    if (event.watchedAt.getTime() < todayStart) {
      continue;
    }

    for (const keyword of extractVideoKeywords(event.videoTitle)) {
      const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
      if (pattern.test(haystack)) {
        return {
          matchedKeyword: keyword,
          matchedVideoTitle: event.videoTitle,
        };
      }
    }
  }

  return { matchedKeyword: null, matchedVideoTitle: null };
}

export function evaluateInboxRelevanceSync(
  message: { senderEmail: string; subject: string; body: string },
  watchEvents: WatchEventLike[],
  now: Date = new Date()
): RelevanceSyncInfo {
  if (!isPromotionalEmail(message)) {
    return {
      promoted: false,
      matchedKeyword: null,
      matchedVideoTitle: null,
      presentation: {
        pinToTop: false,
        borderStyle: "standard",
      },
    };
  }

  const match = findMatchingQuanttubeKeyword(message, watchEvents, now);
  const promoted = match.matchedKeyword !== null;

  return {
    promoted,
    matchedKeyword: match.matchedKeyword,
    matchedVideoTitle: match.matchedVideoTitle,
    presentation: {
      pinToTop: promoted,
      borderStyle: promoted ? "glowing-holographic" : "standard",
    },
  };
}

export function rankInboxMessagesByRelevance<T extends InboxLikeMessage>(
  messages: T[],
  watchEvents: WatchEventLike[],
  now: Date = new Date()
): Array<T & { relevanceSync: RelevanceSyncInfo }> {
  return messages
    .map((message) => ({
      ...message,
      relevanceSync: evaluateInboxRelevanceSync(message, watchEvents, now),
    }))
    .sort((left, right) => {
      if (left.relevanceSync.promoted !== right.relevanceSync.promoted) {
        return left.relevanceSync.promoted ? -1 : 1;
      }

      return right.receivedAt.getTime() - left.receivedAt.getTime();
    });
}
