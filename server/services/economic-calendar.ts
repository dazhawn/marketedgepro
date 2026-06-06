export interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast: string;
  previous: string;
  actual?: string;
}

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

let cachedEvents: CalendarEvent[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchEconomicCalendar(): Promise<CalendarEvent[]> {
  if (cachedEvents && Date.now() < cacheExpiry) {
    return cachedEvents;
  }

  const response = await fetch(CALENDAR_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });

  if (!response.ok) throw new Error(`Economic calendar fetch failed: ${response.status}`);

  const data = await response.json() as CalendarEvent[];
  cachedEvents = data.filter(e => e.impact !== "Holiday");
  cacheExpiry = Date.now() + CACHE_TTL;
  return cachedEvents;
}

export function getTodayEvents(events: CalendarEvent[]): CalendarEvent[] {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  return events.filter(e => e.date.startsWith(todayStr));
}

export function getTomorrowEvents(events: CalendarEvent[]): CalendarEvent[] {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  return events.filter(e => e.date.startsWith(tomorrowStr));
}

export function filterByHighImpact(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter(e => e.impact === "High" || e.impact === "Medium");
}

export function extractCurrenciesFromSymbol(symbol: string): string[] {
  if (symbol.includes("/")) {
    return symbol.split("/").map(s => s.trim().toUpperCase());
  }
  if (symbol.toUpperCase().startsWith("XAU") || symbol.toUpperCase().startsWith("XAG")) {
    return ["USD"];
  }
  return ["USD"];
}

export function filterByWatchlistCurrencies(
  events: CalendarEvent[],
  symbols: string[]
): CalendarEvent[] {
  const currencies = new Set(symbols.flatMap(extractCurrenciesFromSymbol));
  return events.filter(e => currencies.has(e.country.toUpperCase()));
}
