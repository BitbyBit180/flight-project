// Static, instant enrichment from bundled tables. adsbdb (routes.ts) layers
// on top for anything these miss.

import airlines from "./airlines.json" with { type: "json" };
import types from "./types.json" with { type: "json" };

const AIRLINES = airlines as Record<string, string>;
const TYPES = types as Record<string, string>;

/** Map an ICAO type code (e.g. "B738") to a human name. */
export function lookupType(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return TYPES[code.toUpperCase()];
}

/**
 * Map a callsign to an airline name via its 3-letter ICAO prefix.
 * Only airline-style callsigns resolve; GA tail numbers (e.g. "N123AB") won't.
 */
export function lookupAirline(callsign: string | undefined): string | undefined {
  if (!callsign) return undefined;
  const cs = callsign.trim().toUpperCase();
  if (cs.length < 4) return undefined;
  const prefix = cs.slice(0, 3);
  // Airline callsigns are LLLdddd: 3 letters then a digit.
  if (!/^[A-Z]{3}$/.test(prefix) || !/\d/.test(cs[3])) return undefined;
  return AIRLINES[prefix];
}
