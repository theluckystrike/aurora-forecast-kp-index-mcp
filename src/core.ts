// Pure core for aurora-forecast-kp-index-mcp. The only I/O is keyless reads of NOAA Space Weather Prediction Center
// products and Open-Meteo cloud cover and geocoding, done through an injected fetchText, so the tests run on fixtures.
//
// Sources (public, no key):
//   OVATION nowcast  https://services.swpc.noaa.gov/json/ovation_aurora_latest.json
//   Kp forecast      https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json
//   3-day forecast   https://services.swpc.noaa.gov/text/3-day-forecast.txt
//   alerts           https://services.swpc.noaa.gov/products/alerts.json
//   cloud cover      https://api.open-meteo.com/v1/forecast?hourly=cloud_cover
//   geocoding        https://geocoding-api.open-meteo.com/v1/search
import type { FetchText } from './types.js';

export const REPO = 'aurora-forecast-kp-index-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;

export const SWPC = 'https://services.swpc.noaa.gov';
export const METEO = 'https://api.open-meteo.com';
export const GEO = 'https://geocoding-api.open-meteo.com';
export const KP_URL = `${SWPC}/products/noaa-planetary-k-index-forecast.json`;
export const THREE_DAY_URL = `${SWPC}/text/3-day-forecast.txt`;
export const OVATION_URL = `${SWPC}/json/ovation_aurora_latest.json`;
export const ALERTS_URL = `${SWPC}/products/alerts.json`;

export class InputError extends Error {}
export class UpstreamError extends Error {}

export const SOURCE = 'NOAA SWPC OVATION aurora model and planetary Kp forecast (swpc.noaa.gov); cloud cover from Open-Meteo. ' +
  'Kp-to-oval reach is NOAA\'s rule of thumb on a dipole geomagnetic latitude, not a guarantee.';

async function getJson<T = unknown>(f: FetchText, url: string, cacheTtl: number, timeoutMs = 20000): Promise<T> {
  const body = await f(url, { cacheTtl, timeoutMs, accept: 'application/json' });
  try { return JSON.parse(body) as T; } catch { throw new UpstreamError(`${new URL(url).host} returned something that is not JSON`); }
}

export interface Place { name: string; lat: number; lon: number }

export async function resolvePlace(f: FetchText, input: string): Promise<Place> {
  const q = String(input ?? '').trim();
  const ll = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (ll) {
    const lat = +ll[1], lon = +ll[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new InputError('lat,lon out of range');
    return { name: `${lat},${lon}`, lat, lon };
  }
  if (!q) throw new InputError('give a place name or lat,lon');
  const parts = q.split(',').map((x) => x.trim()).filter(Boolean);
  const url = `${GEO}/v1/search?name=${encodeURIComponent(parts[0])}&count=10&language=en&format=json`;
  const j = await getJson<{ results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string; country_code?: string }[] }>(f, url, 86400, 15000);
  const res = j.results ?? [];
  const hint = parts.slice(1).join(' ').toLowerCase();
  const pick = (hint && res.find((r) => [r.admin1, r.country, r.country_code].some((x) => x && (x.toLowerCase() === hint || x.toLowerCase().startsWith(hint) || hint.includes(x.toLowerCase()))))) || res[0];
  if (!pick) throw new InputError(`no place called "${q}" was found; try "City, Country" or lat,lon`);
  return { name: [pick.name, pick.admin1, pick.country].filter(Boolean).join(', '), lat: pick.latitude, lon: pick.longitude };
}

/** North geomagnetic (dipole) pole, IGRF-14 epoch 2025. */
const POLE_LAT = 80.8, POLE_LON = -72.6;

/** Centred-dipole geomagnetic latitude in degrees (negative in the south). */
export function geomagneticLatitude(lat: number, lon: number): number {
  const r = Math.PI / 180;
  const s = Math.sin(lat * r) * Math.sin(POLE_LAT * r) + Math.cos(lat * r) * Math.cos(POLE_LAT * r) * Math.cos((lon - POLE_LON) * r);
  return Math.asin(Math.max(-1, Math.min(1, s))) / r;
}

/**
 * Geomagnetic latitude of the equatorward edge of the auroral oval for a Kp value, the table NOAA SWPC's aurora
 * viewing guidance is drawn from (66.5 degrees at Kp 0, about two degrees per Kp step, 48.1 at Kp 9).
 */
const OVAL = [66.5, 64.5, 62.4, 60.4, 58.3, 56.3, 54.2, 52.2, 50.1, 48.1];
export function ovalEdge(kp: number): number {
  const k = Math.max(0, Math.min(9, kp));
  const i = Math.floor(k);
  return i >= 9 ? OVAL[9] : OVAL[i] + (OVAL[i + 1] - OVAL[i]) * (k - i);
}
/** Aurora high in the sky reaches about this far equatorward of the oval edge on the horizon. */
export const HORIZON_REACH = 6;

/** The lowest Kp at which a place sees aurora on its poleward horizon, and overhead. */
export function kpNeeded(gmLat: number): { horizon: number | null; overhead: number | null } {
  const a = Math.abs(gmLat);
  const find = (lim: number) => {
    for (let k = 0; k <= 9; k += 1 / 3) if (lim >= ovalEdge(k)) return Math.round(k * 3) / 3;
    return null;
  };
  return { horizon: find(a + HORIZON_REACH), overhead: find(a) };
}

export function gScale(kp: number): string {
  if (kp >= 9) return 'G5 extreme storm';
  if (kp >= 8) return 'G4 severe storm';
  if (kp >= 7) return 'G3 strong storm';
  if (kp >= 6) return 'G2 moderate storm';
  if (kp >= 5) return 'G1 minor storm';
  if (kp >= 4) return 'active';
  return 'quiet';
}

export function fmtKp(kp: number): string {
  const whole = Math.floor(kp + 1e-6);
  const frac = kp - whole;
  return frac > 0.5 ? `${whole + 1}-` : frac > 0.17 ? `${whole}+` : `${whole}`;
}

/** Sun altitude in degrees (low-precision solar position, about 0.01 degree for 1950-2050). */
export function sunAltitude(lat: number, lon: number, at: Date): number {
  const r = Math.PI / 180;
  const d = at.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * r;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r;
  const e = (23.439 - 0.00000036 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const lha = (gmst * 15 + lon) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(lha)) / r;
}

export interface KpSlot { start: Date; kp: number; kind: 'observed' | 'estimated' | 'predicted' }

export function parseKp(j: unknown): KpSlot[] {
  if (!Array.isArray(j)) throw new UpstreamError('SWPC Kp forecast was not a list');
  const out: KpSlot[] = [];
  for (const r of j as unknown[]) {
    let tag: string, kp: number, kind: string;
    if (Array.isArray(r)) {
      if (r[0] === 'time_tag') continue; // older header-row format
      [tag, kp, kind] = [String(r[0]), Number(r[1]), String(r[2])];
    } else {
      const o = r as Record<string, unknown>;
      [tag, kp, kind] = [String(o.time_tag), Number(o.kp ?? o.Kp), String(o.observed ?? '')];
    }
    const t = new Date(`${tag.replace(' ', 'T').slice(0, 19)}Z`);
    if (!Number.isFinite(kp) || isNaN(t.getTime())) continue;
    out.push({ start: t, kp, kind: kind === 'predicted' ? 'predicted' : kind === 'estimated' ? 'estimated' : 'observed' });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The "NOAA Kp index breakdown" table of SWPC's 3-day forecast text. The JSON forecast leaves out the current UTC
 * day's remaining blocks (measured 2026-11-14), so tonight would have no Kp at all without this table.
 */
export function parse3Day(txt: string): KpSlot[] {
  const head = /NOAA Kp index breakdown\s+([A-Z][a-z]{2})\s+(\d{1,2})\s*-\s*[A-Z][a-z]{2}\s+\d{1,2}\s+(\d{4})/.exec(txt);
  if (!head) return [];
  const m0 = MONTHS.indexOf(head[1]);
  if (m0 < 0) return [];
  const first = Date.UTC(+head[3], m0, +head[2]);
  const out: KpSlot[] = [];
  for (const line of txt.slice(head.index).split('\n')) {
    const row = /^\s*(\d{2})-(\d{2})UT\s+(.*)$/.exec(line);
    if (!row) continue;
    const vals = [...row[3].matchAll(/(\d+(?:\.\d+)?)(?:\s*\(G\d\))?/g)].map((m) => Number(m[1]));
    vals.slice(0, 3).forEach((kp, day) => {
      out.push({ start: new Date(first + day * 86400000 + Number(row[1]) * 3600000), kp, kind: 'predicted' });
    });
  }
  return out;
}

/** Observed and predicted Kp, JSON first, the 3-day text filling any block the JSON lacks. */
export function mergeKp(json: KpSlot[], text: KpSlot[]): KpSlot[] {
  const have = new Set(json.map((s) => s.start.getTime()));
  return [...json, ...text.filter((s) => !have.has(s.start.getTime()))].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function kpSeries(f: FetchText): Promise<KpSlot[]> {
  const [j, t] = await Promise.all([
    getJson(f, KP_URL, 900),
    f(THREE_DAY_URL, { cacheTtl: 900, accept: 'text/plain' }).catch(() => ''),
  ]);
  return mergeKp(parseKp(j), parse3Day(t));
}

export function kpAt(series: KpSlot[], at: Date): KpSlot | undefined {
  return series.find((s) => s.start <= at && at.getTime() < s.start.getTime() + 3 * 3600000);
}

export interface Ovation { observed: string; forecast: string; grid: number[] }

export function parseOvation(j: unknown): Ovation {
  const o = j as { 'Observation Time'?: string; 'Forecast Time'?: string; coordinates?: number[][] };
  if (!Array.isArray(o?.coordinates) || o.coordinates.length !== 360 * 181) throw new UpstreamError('SWPC OVATION grid had an unexpected shape');
  const grid = new Array<number>(360 * 181);
  for (const [lon, lat, v] of o.coordinates) grid[lon * 181 + (lat + 90)] = v;
  return { observed: String(o['Observation Time'] ?? ''), forecast: String(o['Forecast Time'] ?? ''), grid };
}

// The OVATION grid is about 0.9 MB of JSON; one parse per five minutes per process or Worker isolate.
let OVATION: { at: number; f: FetchText; data: Ovation } | null = null;
export async function ovation(f: FetchText): Promise<Ovation> {
  if (OVATION && OVATION.f === f && Date.now() - OVATION.at < 300000) return OVATION.data;
  const data = parseOvation(await getJson(f, OVATION_URL, 300, 20000));
  OVATION = { at: Date.now(), f, data };
  return data;
}

/** OVATION probability (percent) at the nearest 1-degree grid point. */
export function ovationAt(o: Ovation, lat: number, lon: number): number {
  const la = Math.max(-90, Math.min(90, Math.round(lat)));
  const lo = ((Math.round(lon) % 360) + 360) % 360;
  return o.grid[lo * 181 + (la + 90)] ?? 0;
}

/** The highest OVATION value within `deg` degrees of latitude poleward of the place: aurora you could see on the horizon. */
export function ovationPoleward(o: Ovation, lat: number, lon: number, deg = HORIZON_REACH): number {
  const step = lat >= 0 ? 1 : -1;
  let best = 0;
  for (let d = 0; d <= deg; d++) best = Math.max(best, ovationAt(o, lat + d * step, lon));
  return best;
}

export interface Clouds { tz: string; offsetSec: number; byHour: Map<number, number> }

export async function clouds(f: FetchText, lat: number, lon: number, days = 3): Promise<Clouds> {
  const url = `${METEO}/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=cloud_cover&forecast_days=${days}&timezone=auto&timeformat=unixtime`;
  const j = await getJson<{ timezone?: string; utc_offset_seconds?: number; hourly?: { time?: number[]; cloud_cover?: (number | null)[] } }>(f, url, 1800, 15000);
  const byHour = new Map<number, number>();
  const t = j.hourly?.time ?? [], c = j.hourly?.cloud_cover ?? [];
  t.forEach((s, i) => { if (typeof c[i] === 'number') byHour.set(s * 1000, c[i] as number); });
  return { tz: j.timezone ?? 'UTC', offsetSec: j.utc_offset_seconds ?? 0, byHour };
}

export function cloudAt(c: Clouds, at: Date): number | undefined {
  return c.byHour.get(Math.floor(at.getTime() / 3600000) * 3600000);
}

export function localTime(offsetSec: number, at: Date): string {
  return new Date(at.getTime() + offsetSec * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export interface Alert { issued: string; code: string; title: string }

export function parseAlerts(j: unknown): Alert[] {
  if (!Array.isArray(j)) throw new UpstreamError('SWPC alerts were not a list');
  return (j as { issue_datetime?: string; message?: string }[]).map((a) => {
    const msg = String(a.message ?? '').replace(/\r/g, '');
    const code = /Space Weather Message Code:\s*(\S+)/.exec(msg)?.[1] ?? '';
    const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines.find((l) => /^(ALERT|WARNING|WATCH|SUMMARY|CONTINUED ALERT|EXTENDED WARNING|CANCEL)/i.test(l)) ?? lines[3] ?? '';
    return { issued: String(a.issue_datetime ?? '').slice(0, 16), code, title };
  });
}

export interface HourVerdict {
  at: Date; sun: number; kp: number; kpKind: string; cloud?: number;
  zone: 'overhead' | 'horizon' | 'none'; verdict: 'good' | 'possible' | 'unlikely'; why: string;
}

/** One hour judged on darkness, Kp-driven oval reach and cloud cover. */
export function judgeHour(gmLat: number, at: Date, sun: number, kp: KpSlot | undefined, cloud: number | undefined): HourVerdict {
  const k = kp?.kp ?? 0;
  const edge = ovalEdge(k);
  const a = Math.abs(gmLat);
  const zone = a >= edge ? 'overhead' : a + HORIZON_REACH >= edge ? 'horizon' : 'none';
  const dark = sun <= -12;
  const clear = cloud === undefined ? true : cloud <= 50;
  let verdict: HourVerdict['verdict'] = 'unlikely';
  const why: string[] = [];
  if (!dark) why.push(sun > -6 ? 'daylight or twilight' : 'not dark enough');
  if (zone === 'none') why.push(`Kp ${fmtKp(k)} keeps the oval too far poleward`);
  if (!clear) why.push(`${cloud}% cloud`);
  if (dark && clear && zone === 'overhead') verdict = 'good';
  else if (dark && clear && zone === 'horizon') verdict = 'possible';
  if (verdict !== 'unlikely') why.push(zone === 'overhead' ? 'inside the oval for this Kp' : 'oval within view on the poleward horizon');
  return { at, sun, kp: k, kpKind: kp?.kind ?? 'none', cloud, zone, verdict, why: why.join('; ') };
}

function placeInfo(p: Place) {
  const gm = geomagneticLatitude(p.lat, p.lon);
  const need = kpNeeded(gm);
  const lines = [
    `Place: ${p.name} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}), geomagnetic latitude ${gm.toFixed(1)}`,
    `Kp needed here: ${need.horizon === null ? 'beyond Kp 9 (aurora is very rarely seen this far from the poles)' : `about ${fmtKp(need.horizon)} for aurora low on the ${p.lat >= 0 ? 'northern' : 'southern'} horizon`}` +
      (need.overhead === null ? '' : `, ${fmtKp(need.overhead)} for overhead`),
  ];
  return { gm, need, lines };
}

/** Hourly verdicts over the next `hours`, darkness first so cloud and Kp are only fetched once. */
async function nightHours(f: FetchText, p: Place, hours: number, now: Date) {
  const [series, cl] = await Promise.all([kpSeries(f), clouds(f, p.lat, p.lon, Math.min(4, Math.ceil(hours / 24) + 1))]);
  const gm = geomagneticLatitude(p.lat, p.lon);
  const start = Math.ceil(now.getTime() / 3600000) * 3600000;
  const rows: HourVerdict[] = [];
  let maxKp = 0;
  for (let h = 0; h < hours; h++) {
    const at = new Date(start + h * 3600000);
    const sun = sunAltitude(p.lat, p.lon, at);
    if (sun > -12) continue;
    const kp = kpAt(series, at);
    if (kp) maxKp = Math.max(maxKp, kp.kp);
    rows.push(judgeHour(gm, at, sun, kp, cloudAt(cl, at)));
  }
  return { rows, offsetSec: cl.offsetSec, tz: cl.tz, maxKp };
}

const base = (now: Date) => ({ as_of: now.toISOString(), source: SOURCE, more: more() });

export async function auroraTonight(f: FetchText, a: { location: string; nights?: number }, now = new Date()) {
  const n = a.nights ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 3) throw new InputError('nights must be 1, 2 or 3');
  const p = await resolvePlace(f, a.location);
  const { rows, offsetSec, tz, maxKp } = await nightHours(f, p, 24 * n, now);
  const info = placeInfo(p);
  const lines = [...info.lines, `Times: local (${tz}). Dark = sun 12 degrees or more below the horizon.`, ''];
  const good = rows.filter((r) => r.verdict === 'good'), possible = rows.filter((r) => r.verdict === 'possible');
  const best = good[0] ?? possible[0];
  const verdict = !rows.length ? 'NO DARK HOURS' : good.length ? 'GOOD' : possible.length ? 'POSSIBLE' : 'UNLIKELY';
  if (!rows.length) {
    lines.push('No dark hours in this window: the sky never gets dark enough here (midnight sun or polar twilight), so aurora cannot be seen.');
  } else {
    lines.push(
      `Verdict: ${good.length ? 'GOOD chance' : possible.length ? 'POSSIBLE, low on the horizon' : 'UNLIKELY'} ` +
        `(${good.length} good, ${possible.length} possible of ${rows.length} dark hours; highest Kp in window ${fmtKp(maxKp)}, ${gScale(maxKp)})`,
    );
    if (best) lines.push(`First worthwhile hour: ${localTime(offsetSec, best.at)} local`);
    lines.push('', 'Hour (local)       Kp    oval      cloud  verdict');
    for (const r of rows) {
      lines.push(`${localTime(offsetSec, r.at)}  ${fmtKp(r.kp).padEnd(4)}  ${r.zone.padEnd(8)}  ${r.cloud === undefined ? '  n/a' : `${String(r.cloud).padStart(3)}%`}  ${r.verdict}${r.kpKind === 'none' ? ' (no Kp forecast this far out)' : ''}`);
    }
  }
  return {
    summary: lines.join('\n'),
    place: p, geomagnetic_latitude: Number(info.gm.toFixed(1)), kp_needed: info.need, timezone: tz, verdict,
    first_worthwhile_hour_local: best ? localTime(offsetSec, best.at) : null, max_kp: maxKp,
    hours: rows.map((r) => ({ local: localTime(offsetSec, r.at), kp: r.kp, kp_kind: r.kpKind, oval: r.zone, cloud_percent: r.cloud ?? null, verdict: r.verdict })),
    ...base(now),
  };
}

export async function auroraNow(f: FetchText, a: { location: string }, now = new Date()) {
  const p = await resolvePlace(f, a.location);
  const [ov, series, cl] = await Promise.all([ovation(f), kpSeries(f), clouds(f, p.lat, p.lon, 1)]);
  const sun = sunAltitude(p.lat, p.lon, now);
  const kp = kpAt(series, now) ?? [...series].reverse().find((s) => s.start <= now);
  const cloud = cloudAt(cl, now);
  const here = ovationAt(ov, p.lat, p.lon);
  const pole = ovationPoleward(ov, p.lat, p.lon);
  const v = judgeHour(geomagneticLatitude(p.lat, p.lon), now, sun, kp, cloud);
  const verdict = sun > -12 ? 'not dark enough to see aurora now' : pole >= 10 && (cloud ?? 0) <= 50 ? 'GO LOOK: aurora is likely in view' : v.verdict === 'unlikely' ? 'UNLIKELY right now' : 'POSSIBLE: watch the poleward horizon';
  const info = placeInfo(p);
  const lines = [
    ...info.lines, '',
    `Now: ${localTime(cl.offsetSec, now)} local (${cl.tz})`,
    `OVATION aurora probability overhead: ${here}%; strongest within view on the ${p.lat >= 0 ? 'northern' : 'southern'} horizon: ${pole}%`,
    `OVATION run: observed ${ov.observed}, valid for ${ov.forecast}`,
    `Kp now: ${kp ? `${fmtKp(kp.kp)} (${kp.kind}, ${gScale(kp.kp)})` : 'unknown'}`,
    `Sky: sun at ${sun.toFixed(1)} degrees (${sun <= -12 ? 'dark' : sun <= -6 ? 'nautical twilight' : sun <= 0 ? 'civil twilight' : 'daylight'}), cloud ${cloud === undefined ? 'n/a' : `${cloud}%`}`,
    `Verdict: ${verdict} (${v.why})`,
  ];
  return {
    summary: lines.join('\n'),
    place: p, ovation_overhead_percent: here, ovation_horizon_percent: pole, ovation_observed: ov.observed, ovation_forecast: ov.forecast,
    kp: kp ? { value: kp.kp, display: fmtKp(kp.kp), kind: kp.kind, scale: gScale(kp.kp) } : null,
    sun_altitude: Number(sun.toFixed(1)), cloud_percent: cloud ?? null, verdict, ...base(now),
  };
}

export async function kpForecast(f: FetchText, now = new Date()) {
  const series = await kpSeries(f);
  const t = now.getTime();
  const recent = series.filter((s) => s.kind !== 'predicted' && s.start.getTime() >= t - 24 * 3600000);
  const ahead = series.filter((s) => s.kind === 'predicted' && s.start.getTime() + 3 * 3600000 > t);
  const iso = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
  const lines = ['Planetary Kp, 3-hour blocks, times UTC.', '', 'Last 24 hours:'];
  for (const s of recent) lines.push(`  ${iso(s.start)}  Kp ${fmtKp(s.kp).padEnd(3)} ${s.kind}  ${gScale(s.kp)}`);
  lines.push('', 'Forecast:');
  const byDay = new Map<string, number>();
  for (const s of ahead) {
    lines.push(`  ${iso(s.start)}  Kp ${fmtKp(s.kp).padEnd(3)} ${gScale(s.kp)}`);
    const d = s.start.toISOString().slice(0, 10);
    byDay.set(d, Math.max(byDay.get(d) ?? 0, s.kp));
  }
  const daily = [...byDay].map(([date, k]) => ({ date, max_kp: k, display: fmtKp(k), scale: gScale(k) }));
  lines.push('', 'Daily maximum forecast Kp: ' + daily.map((d) => `${d.date} ${d.display} (${d.scale})`).join('; '));
  return {
    summary: lines.join('\n'),
    daily_max: daily,
    recent: recent.map((s) => ({ start_utc: iso(s.start), kp: s.kp, kind: s.kind })),
    forecast: ahead.map((s) => ({ start_utc: iso(s.start), kp: s.kp, scale: gScale(s.kp) })),
    ...base(now), source: 'NOAA SWPC planetary K-index forecast and 3-day forecast (services.swpc.noaa.gov).',
  };
}

export async function spaceWeatherAlerts(f: FetchText, a: { hours?: number; geomagnetic_only?: boolean }, now = new Date()) {
  const h = a.hours ?? 48;
  if (!(h >= 1 && h <= 168)) throw new InputError('hours must be between 1 and 168');
  const cutoff = now.getTime() - h * 3600000;
  const all = parseAlerts(await getJson(f, ALERTS_URL, 600));
  const rows = all
    .filter((x) => new Date(`${x.issued.replace(' ', 'T')}Z`).getTime() >= cutoff)
    .filter((x) => !a.geomagnetic_only || /^(ALTK|WARK|WATA|ALTGM|SUMK|WARSUD|WATGM)/.test(x.code) || /geomagnetic|K-index/i.test(x.title))
    .sort((x, y) => y.issued.localeCompare(x.issued));
  const lines = [`SWPC messages in the last ${h} hours${a.geomagnetic_only ? ' (geomagnetic only)' : ''}: ${rows.length}`];
  for (const x of rows.slice(0, 40)) lines.push(`  ${x.issued} UTC  ${x.code.padEnd(8)} ${x.title}`);
  if (rows.length > 40) lines.push(`  ...and ${rows.length - 40} older`);
  return { summary: lines.join('\n'), count: rows.length, alerts: rows.slice(0, 40), ...base(now), source: 'NOAA SWPC alerts feed (services.swpc.noaa.gov/products/alerts.json).' };
}

export async function compareLocations(f: FetchText, a: { locations: string[] }, now = new Date()) {
  const list = a.locations ?? [];
  if (list.length < 2 || list.length > 10) throw new InputError('give 2 to 10 locations');
  const results = await Promise.all(list.map(async (loc) => {
    try {
      const p = await resolvePlace(f, loc);
      const { rows, offsetSec } = await nightHours(f, p, 24, now);
      const good = rows.filter((r) => r.verdict === 'good'), possible = rows.filter((r) => r.verdict === 'possible');
      const first = good[0] ?? possible[0];
      const need = kpNeeded(geomagneticLatitude(p.lat, p.lon));
      return { loc, p, score: good.length * 2 + possible.length, good: good.length, possible: possible.length, dark: rows.length, first: first ? localTime(offsetSec, first.at) : '', need };
    } catch (e) {
      if (e instanceof InputError) return { loc, err: e.message };
      throw e;
    }
  }));
  const ok = results.filter((r): r is Exclude<typeof r, { err: string }> => !('err' in r)).sort((x, y) => y.score - x.score);
  const lines = ['Tonight (next 24 hours), best first:'];
  ok.forEach((r, i) => lines.push(
    `${i + 1}. ${r.p.name}: ${r.good} good, ${r.possible} possible of ${r.dark} dark hours` +
      `${r.first ? `; first worthwhile hour ${r.first} local` : ''}; Kp needed on horizon ${r.need.horizon === null ? '>9' : fmtKp(r.need.horizon)}`,
  ));
  const errors = results.filter((r): r is { loc: string; err: string } => 'err' in r);
  for (const r of errors) lines.push(`- ${r.loc}: ${r.err}`);
  return {
    summary: lines.join('\n'),
    ranking: ok.map((r) => ({ place: r.p.name, good_hours: r.good, possible_hours: r.possible, dark_hours: r.dark, first_worthwhile_hour_local: r.first || null, kp_needed_horizon: r.need.horizon })),
    not_found: errors.map((r) => ({ location: r.loc, error: r.err })),
    ...base(now),
  };
}
