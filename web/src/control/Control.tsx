import { useEffect, useMemo, useRef, useState } from "react";
import type { Config, ShowFields } from "@shared/index.js";
import { useStream } from "../lib/useStream.js";
import { nextISSPass, type Tle } from "../display/celestial.js";
import { ColorRow, Row, Section, Segmented, Slider, Toggle } from "./components.js";

function skyTimeLabel(offsetMin: number): string {
  if (offsetMin === 0) return "live";
  const d = new Date(Date.now() + offsetMin * 60000);
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtIn(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

type Preset = { label: string; lat: number; lon: number };
const LOCATION_PRESETS: Preset[] = [
  { label: "SFO", lat: 37.6213, lon: -122.379 },
  { label: "JFK", lat: 40.6413, lon: -73.7781 },
  { label: "LAX", lat: 33.9416, lon: -118.4085 },
  { label: "ORD", lat: 41.9742, lon: -87.9073 },
  { label: "LHR", lat: 51.47, lon: -0.4543 },
  { label: "CDG", lat: 49.0097, lon: 2.5479 },
  { label: "NRT", lat: 35.772, lon: 140.3929 },
  { label: "SYD", lat: -33.9399, lon: 151.1753 },
];

function fmtCoord(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

// OpenStreetMap Nominatim geocoder — free, no API key, CORS-friendly.
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
// (max 1 req/s, must include a Referer / contact). We throttle on the
// client side and attribute OSM in the UI.
type GeocodeResult = {
  display_name: string;
  short_name?: string;
  lat: string;
  lon: string;
  type?: string;
  importance?: number;
};

async function geocode(query: string, signal: AbortSignal): Promise<GeocodeResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("limit", "6");
  url.searchParams.set("dedupe", "1");
  const r = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`geocode ${r.status}`);
  return (await r.json()) as GeocodeResult[];
}

type ReverseResult = {
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    suburb?: string;
    municipality?: string;
    county?: string;
    state?: string;
    region?: string;
    country?: string;
    country_code?: string;
  };
};

async function reverseGeocode(
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<ReverseResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");
  const r = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`reverse ${r.status}`);
  return (await r.json()) as ReverseResult;
}

function shortPlaceName(a: ReverseResult["address"]): string | null {
  if (!a) return null;
  const city =
    a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb;
  const region = a.state || a.region || a.county;
  const country = a.country;
  const parts = [city, region, country].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

const FIELD_LABELS: Record<keyof ShowFields, string> = {
  airline: "Airline",
  flight: "Flight",
  type: "Type",
  altitude: "Altitude",
  speed: "Speed",
  verticalRate: "Vert. rate",
  origin: "Origin",
  destination: "Destination",
  registration: "Registration",
};

export function Control() {
  const { state, conn } = useStream("control");
  const cfg = state.config;

  // ISS pass finder (for the Sky section).
  const [tles, setTles] = useState<Tle[]>([]);
  useEffect(() => {
    let on = true;
    fetch("/api/tle")
      .then((r) => (r.ok ? r.json() : []))
      .then((t) => on && setTles(t as Tle[]))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  const nextPass = useMemo(
    () => (tles.length && cfg ? nextISSPass(Date.now(), cfg.centerLat, cfg.centerLon, tles) : null),
    [tles, cfg?.centerLat, cfg?.centerLon],
  );

  // --- Location editors: local text so the user can type intermediate
  // values (e.g. "-", "37.") without spamming the server with bad numbers.
  const [latText, setLatText] = useState(() => fmtCoord(cfg?.centerLat ?? 0));
  const [lonText, setLonText] = useState(() => fmtCoord(cfg?.centerLon ?? 0));
  const [gettingLoc, setGettingLoc] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    if (cfg) setLatText(fmtCoord(cfg.centerLat));
  }, [cfg?.centerLat]);
  useEffect(() => {
    if (cfg) setLonText(fmtCoord(cfg.centerLon));
  }, [cfg?.centerLon]);

  // --- Place search (Nominatim) ---------------------------------------
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // Debounced fetch on query change.
  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const ac = new AbortController();
    const t = setTimeout(() => {
      geocode(q, ac.signal)
        .then((r) => {
          setResults(r);
          setActiveIdx(0);
          setShowResults(true);
        })
        .catch((e) => {
          if (e?.name !== "AbortError") {
            setSearchError("Search unavailable");
            setResults([]);
          }
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [searchQ]);

  // Click-outside to close dropdown.
  useEffect(() => {
    if (!showResults) return;
    const onDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showResults]);

  // --- Reverse geocode the current center so the user can see *where*
  // the numbers actually point (handy after "Use my location").
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [placePending, setPlacePending] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    const lat = cfg.centerLat;
    const lon = cfg.centerLon;
    setPlacePending(true);
    const ac = new AbortController();
    const t = setTimeout(() => {
      reverseGeocode(lat, lon, ac.signal)
        .then((r) => {
          const name = r ? shortPlaceName(r.address) ?? r.display_name : null;
          setPlaceName(name);
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setPlaceName(null);
        })
        .finally(() => setPlacePending(false));
    }, 600);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [cfg?.centerLat, cfg?.centerLon]);

  if (!cfg) {
    return (
      <div className="loading">
        <div className={`dot ${state.connected ? "ok" : "bad"}`} />
        {state.connected ? "Loading config…" : "Connecting to tracker…"}
      </div>
    );
  }

  const set = (patch: Partial<Config>) => conn.patchConfig(patch);
  const setField = (k: keyof ShowFields, v: boolean) =>
    conn.patchConfig({ showFields: { ...cfg.showFields, [k]: v } });

  const commitLocation = (lat: number, lon: number) => {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setLocError("Latitude must be between -90 and 90");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setLocError("Longitude must be between -180 and 180");
      return;
    }
    setLocError(null);
    const rLat = Math.round(lat * 1e4) / 1e4;
    const rLon = Math.round(lon * 1e4) / 1e4;
    if (rLat === cfg.centerLat && rLon === cfg.centerLon) return;
    conn.patchConfig({ centerLat: rLat, centerLon: rLon });
  };

  const useDeviceLocation = () => {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError("Geolocation not supported in this browser");
      return;
    }
    setGettingLoc(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        commitLocation(pos.coords.latitude, pos.coords.longitude);
        setGettingLoc(false);
      },
      (err) => {
        setGettingLoc(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied"
            : "Could not get location",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const pickResult = (r: GeocodeResult) => {
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      commitLocation(lat, lon);
    }
    setSearchQ(r.display_name);
    setShowResults(false);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (results[activeIdx]) {
        e.preventDefault();
        pickResult(results[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setShowResults(false);
    }
  };

  return (
    <div className="control">
      <header className="topbar">
        <div className="brand">
          <span className={`dot ${state.connected ? "ok" : "bad"}`} />
          Ceiling Tracker
        </div>
        <div className="stat">
          {state.status?.source ?? "—"} · {state.aircraft.length} overhead
        </div>
      </header>

      <main>
        <Section title="Location">
          <div className="loc-search" ref={searchWrapRef}>
            <div className="loc-search-input">
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                placeholder="Search city, address, airport…"
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => results.length && setShowResults(true)}
                onKeyDown={onSearchKey}
              />
              {searching && <span className="spinner" aria-label="searching" />}
              {searchQ && !searching && (
                <button
                  type="button"
                  className="clear"
                  aria-label="clear"
                  onClick={() => {
                    setSearchQ("");
                    setResults([]);
                    setShowResults(false);
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {showResults && (results.length > 0 || searchError) && (
              <ul className="loc-results" role="listbox">
                {searchError && <li className="loc-empty">{searchError}</li>}
                {!searchError && results.map((r, i) => (
                  <li
                    key={`${r.lat},${r.lon}-${i}`}
                    className={`loc-result ${i === activeIdx ? "active" : ""}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickResult(r);
                    }}
                  >
                    <span className="loc-result-name">{r.display_name}</span>
                    {r.type && <span className="loc-result-type">{r.type}</span>}
                  </li>
                ))}
                {!searchError && results.length === 0 && !searching && searchQ.trim().length >= 2 && (
                  <li className="loc-empty">No matches</li>
                )}
              </ul>
            )}
          </div>
          <Row label="Latitude">
            <input
              className="num"
              type="number"
              inputMode="decimal"
              step="0.0001"
              min={-90}
              max={90}
              value={latText}
              onChange={(e) => setLatText(e.target.value)}
              onBlur={() => commitLocation(parseFloat(latText), cfg.centerLon)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </Row>
          <Row label="Longitude">
            <input
              className="num"
              type="number"
              inputMode="decimal"
              step="0.0001"
              min={-180}
              max={180}
              value={lonText}
              onChange={(e) => setLonText(e.target.value)}
              onBlur={() => commitLocation(cfg.centerLat, parseFloat(lonText))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </Row>
          <div className="loc-current">
            <span className="loc-current-label">Current:</span>{" "}
            {placePending && !placeName ? (
              <span className="loc-current-pending">looking up…</span>
            ) : placeName ? (
              <span className="loc-current-name">{placeName}</span>
            ) : (
              <span className="loc-current-pending">—</span>
            )}
          </div>
          <div className="chips">
            <button
              className="chip"
              onClick={useDeviceLocation}
              disabled={gettingLoc}
            >
              {gettingLoc ? "Locating…" : "Use my location"}
            </button>
            {LOCATION_PRESETS.map((p) => (
              <button
                key={p.label}
                className="chip"
                onClick={() => commitLocation(p.lat, p.lon)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {locError && <div className="loc-error">{locError}</div>}
          <div className="loc-note">
            Stars, sun, moon, and satellites update for this location automatically. To change the drawn runways, edit <code>web/src/display/airports.ts</code>.
            <br />
            Place search by <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>.
          </div>
        </Section>

        <Section title="Calibration">
          <Row label="Rotation" hint="align field to ceiling">
            <Slider value={cfg.rotationDeg} min={0} max={355} step={5} unit="°"
              onChange={(v) => set({ rotationDeg: v })} />
          </Row>
          <Row label="Mirror horizontally" hint="looking-up flip">
            <Toggle value={cfg.mirrorX} onChange={(v) => set({ mirrorX: v })} />
          </Row>
          <Row label="Mirror vertically">
            <Toggle value={cfg.mirrorY} onChange={(v) => set({ mirrorY: v })} />
          </Row>
          <Row label="Label rotation" hint="text only, not the map">
            <Slider value={cfg.labelRotationDeg} min={0} max={355} step={5} unit="°"
              onChange={(v) => set({ labelRotationDeg: v })} />
          </Row>
          <Row label="Radius">
            <Slider value={cfg.radiusKm} min={1} max={500} step={5} unit="km"
              onChange={(v) => set({ radiusKm: v })} />
          </Row>
        </Section>

        <Section title="View">
          <Row label="Theme">
            <Segmented value={cfg.theme}
              options={[
                { value: "ambient", label: "Ambient" },
                { value: "telemetry", label: "Telemetry" },
                { value: "focus", label: "Focus" },
              ]}
              onChange={(v) => set({ theme: v })} />
          </Row>
          <Row label="Brightness">
            <Slider value={cfg.brightness} min={0.1} max={1} step={0.05}
              onChange={(v) => set({ brightness: v })} />
          </Row>
          <Row label="Glyph size">
            <Slider value={cfg.glyphSizePx} min={6} max={40} step={1} unit="px"
              onChange={(v) => set({ glyphSizePx: v })} />
          </Row>
          <Row label="Trail length">
            <Slider value={cfg.trailSeconds} min={0} max={120} step={5} unit="s"
              onChange={(v) => set({ trailSeconds: v })} />
          </Row>
          <Row label="Color by altitude">
            <Toggle value={cfg.altitudeColor} onChange={(v) => set({ altitudeColor: v })} />
          </Row>
        </Section>

        <Section title="Labels">
          <Row label="Density">
            <Segmented value={cfg.labelDensity}
              options={[
                { value: "all", label: "All" },
                { value: "nearestN", label: "Nearest N" },
                { value: "nearestOnly", label: "Nearest" },
              ]}
              onChange={(v) => set({ labelDensity: v })} />
          </Row>
          {cfg.labelDensity === "nearestN" && (
            <Row label="N">
              <Slider value={cfg.nearestN} min={1} max={20} step={1}
                onChange={(v) => set({ nearestN: v })} />
            </Row>
          )}
          <div className="chips">
            {(Object.keys(FIELD_LABELS) as (keyof ShowFields)[]).map((k) => (
              <button key={k}
                className={`chip ${cfg.showFields[k] ? "on" : ""}`}
                onClick={() => setField(k, !cfg.showFields[k])}>
                {FIELD_LABELS[k]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Filters">
          <Row label="Min altitude" hint="hide ground/taxi">
            <Slider value={cfg.minAltitudeFt} min={0} max={10000} step={100} unit="ft"
              onChange={(v) => set({ minAltitudeFt: v })} />
          </Row>
          <Row label="Max altitude">
            <Slider value={cfg.maxAltitudeFt} min={1000} max={60000} step={1000} unit="ft"
              onChange={(v) => set({ maxAltitudeFt: v })} />
          </Row>
          <Row label="Hide aircraft on ground">
            <Toggle value={cfg.hideOnGround} onChange={(v) => set({ hideOnGround: v })} />
          </Row>
        </Section>

        <Section title="Motion">
          <Row label="Interpolate">
            <Toggle value={cfg.interpolate} onChange={(v) => set({ interpolate: v })} />
          </Row>
          <Row label="Smoothing" hint="0 snap · 1 slow">
            <Slider value={cfg.smoothing} min={0} max={0.9} step={0.02}
              onChange={(v) => set({ smoothing: v })} />
          </Row>
          <Row label="Max extrapolation">
            <Slider value={cfg.maxExtrapolationSec} min={0} max={15} step={1} unit="s"
              onChange={(v) => set({ maxExtrapolationSec: v })} />
          </Row>
          <Row label="Drop after">
            <Slider value={cfg.staleSec} min={5} max={60} step={1} unit="s"
              onChange={(v) => set({ staleSec: v })} />
          </Row>
          <Row label="Max FPS" hint="0 = uncapped">
            <Slider value={cfg.maxFps} min={0} max={120} step={5} unit="fps"
              onChange={(v) => set({ maxFps: v })} />
          </Row>
        </Section>

        <Section title="Overlays">
          <Row label="Range rings">
            <Toggle value={cfg.rangeRings} onChange={(v) => set({ rangeRings: v })} />
          </Row>
          <Row label="Compass">
            <Toggle value={cfg.compass} onChange={(v) => set({ compass: v })} />
          </Row>
          <Row label="Airport runways">
            <Toggle value={cfg.showAirport} onChange={(v) => set({ showAirport: v })} />
          </Row>
          <Row label="Highlight emergency">
            <Toggle value={cfg.highlightEmergency} onChange={(v) => set({ highlightEmergency: v })} />
          </Row>
          <Row label="On-screen HUD (display)">
            <Toggle value={cfg.showHud} onChange={(v) => set({ showHud: v })} />
          </Row>
        </Section>

        <Section title="Sky">
          <Row label="Stars">
            <Toggle value={cfg.showStars} onChange={(v) => set({ showStars: v })} />
          </Row>
          <Row label="Sun">
            <Toggle value={cfg.showSun} onChange={(v) => set({ showSun: v })} />
          </Row>
          <Row label="Moon">
            <Toggle value={cfg.showMoon} onChange={(v) => set({ showMoon: v })} />
          </Row>
          <Row label="Satellites & ISS">
            <Toggle value={cfg.showSatellites} onChange={(v) => set({ showSatellites: v })} />
          </Row>
          <Row label="Star density">
            <Slider value={cfg.starMagLimit} min={1} max={4} step={0.1}
              onChange={(v) => set({ starMagLimit: v })} />
          </Row>
          <Row label="Sky time" hint={skyTimeLabel(cfg.skyTimeOffsetMin)}>
            <Slider value={cfg.skyTimeOffsetMin} min={-720} max={720} step={5} unit="m"
              onChange={(v) => set({ skyTimeOffsetMin: v })} />
          </Row>
          <div className="chips">
            <button className={`chip ${cfg.skyTimeOffsetMin === 0 ? "on" : ""}`}
              onClick={() => set({ skyTimeOffsetMin: 0 })}>
              Live
            </button>
            {nextPass && (
              <button className="chip on"
                onClick={() => set({ skyTimeOffsetMin: Math.round((nextPass - Date.now()) / 60000) })}>
                ISS pass in {fmtIn(nextPass - Date.now())} → jump
              </button>
            )}
          </div>
        </Section>

        <Section title="Window to elsewhere">
          <Row label="Destination arcs" hint="great-circle toward dest">
            <Toggle value={cfg.showDestArc} onChange={(v) => set({ showDestArc: v })} />
          </Row>
          <Row label="Local time & distance">
            <Toggle value={cfg.showRouteDetail} onChange={(v) => set({ showRouteDetail: v })} />
          </Row>
        </Section>

        <Section title="Palette">
          <div className="palette">
            <ColorRow label="Background" value={cfg.palette.bg}
              onChange={(v) => set({ palette: { ...cfg.palette, bg: v } })} />
            <ColorRow label="Glyph" value={cfg.palette.glyph}
              onChange={(v) => set({ palette: { ...cfg.palette, glyph: v } })} />
            <ColorRow label="Trail" value={cfg.palette.trail}
              onChange={(v) => set({ palette: { ...cfg.palette, trail: v } })} />
            <ColorRow label="Accent" value={cfg.palette.accent}
              onChange={(v) => set({ palette: { ...cfg.palette, accent: v } })} />
            <ColorRow label="Warn" value={cfg.palette.warn}
              onChange={(v) => set({ palette: { ...cfg.palette, warn: v } })} />
            <ColorRow label="Grid" value={cfg.palette.grid}
              onChange={(v) => set({ palette: { ...cfg.palette, grid: v } })} />
            <ColorRow label="Text" value={cfg.palette.text}
              onChange={(v) => set({ palette: { ...cfg.palette, text: v } })} />
          </div>
        </Section>

        <Section title="System">
          <button className="reset" onClick={() => conn.resetConfig()}>
            Reset all to defaults
          </button>
        </Section>
      </main>
    </div>
  );
}
