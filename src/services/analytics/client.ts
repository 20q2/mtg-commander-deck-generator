import type { AnalyticsEventType, AnalyticsEventMetadata, AnalyticsEvent } from './types';

const ANALYTICS_URL = import.meta.env.VITE_ANALYTICS_URL as string | undefined;
const METRICS_SECRET = import.meta.env.VITE_METRICS_SECRET as string | undefined;

function getUserId(): string {
  try {
    const KEY = 'mtg_uid';
    let id = localStorage.getItem(KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
    return id;
  } catch {
    return 'unknown';
  }
}

function getRegion(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.startsWith('America/')) return 'Americas';
    if (tz.startsWith('Europe/')) return 'Europe';
    if (tz.startsWith('Asia/')) return 'Asia';
    if (tz.startsWith('Australia/') || tz.startsWith('Pacific/')) return 'Oceania';
    if (tz.startsWith('Africa/')) return 'Africa';
    return 'Other';
  } catch {
    return 'Other';
  }
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 10;

let eventQueue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getAnalyticsUrl(): string | null {
  return ANALYTICS_URL?.trim() || null;
}

/**
 * Track an analytics event. Completely non-blocking and fire-and-forget.
 * Entire body is wrapped in try-catch — this function will NEVER throw or
 * interfere with normal app operation under any circumstances.
 */
export function trackEvent<T extends AnalyticsEventType>(
  event: T,
  metadata: AnalyticsEventMetadata[T]
): void {
  try {
    if (import.meta.env.DEV) {
      console.log('[Analytics]', event, metadata);
    }

    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') return;

    const url = getAnalyticsUrl();
    if (!url) return;

    eventQueue.push({
      event,
      timestamp: new Date().toISOString(),
      metadata: {
        ...(metadata as Record<string, unknown>),
        userId: getUserId(),
        region: getRegion(),
      },
    });

    if (!flushTimer) {
      flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
    }

    if (eventQueue.length >= FLUSH_THRESHOLD) {
      flush();
    }
  } catch {
    // Silently swallow — analytics must never break the app
  }
}

function flush(): void {
  try {
    if (eventQueue.length === 0) return;

    const url = getAnalyticsUrl();
    if (!url) {
      eventQueue = [];
      return;
    }

    const eventsToSend = [...eventQueue];
    eventQueue = [];

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: eventsToSend }),
      keepalive: true,
    }).catch(() => {
      // Silently swallow network errors
    });
  } catch {
    // Silently swallow — analytics must never break the app
    eventQueue = [];
  }
}

// Flush remaining events on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      if (eventQueue.length === 0) return;
      const url = getAnalyticsUrl();
      if (!url) return;

      const body = JSON.stringify({ events: eventQueue });
      navigator.sendBeacon(url, body);
      eventQueue = [];
    } catch {
      // Silently swallow
    }
  });
}

/**
 * Fetch aggregated metrics from the Lambda (for dev dashboard only).
 */
export async function fetchMetrics(params?: {
  from?: string;
  to?: string;
  action?: string;
  eventType?: string;
}): Promise<Record<string, unknown>> {
  const url = getAnalyticsUrl();
  if (!url) throw new Error('Analytics URL not configured');

  const searchParams = new URLSearchParams();
  searchParams.set('action', params?.action || 'summary');
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.eventType) searchParams.set('eventType', params.eventType);

  const headers: Record<string, string> = {};
  if (METRICS_SECRET) headers['Authorization'] = `Bearer ${METRICS_SECRET}`;

  const response = await fetch(`${url}?${searchParams.toString()}`, { headers });
  if (!response.ok) throw new Error(`Analytics fetch failed: ${response.status}`);
  return response.json();
}
