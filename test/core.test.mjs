// Fixtures in test/fixtures/ are NOAA SWPC products downloaded 2026-11-14: the planetary Kp forecast JSON (2026-11-07 to 2026-11-17),
// the 3-day forecast text issued 2026 Nov 14 0030 UTC (Kp breakdown Nov 14 to Nov 16, highest 3.33) and the alerts feed.
// Geocoding, cloud cover and the OVATION grid are built in this file so the verdicts are known in advance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  geomagneticLatitude, ovalEdge, fmtKp, gScale, kpNeeded, parseKp, parse3Day, mergeKp, judgeHour, parseOvation, ovationAt, ovationPoleward,
  auroraTonight, auroraNow, kpForecast, spaceWeatherAlerts, compareLocations, InputError, UpstreamError, KP_URL, THREE_DAY_URL, ALERTS_URL, OVATION_URL, UTM,
} from '../dist/core.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const KP = fx('kp.json'), THREE = fx('3-day-forecast.txt'), ALERTS = fx('alerts.json');
const NOW = new Date('2026-11-14T06:10:00Z'); // 21:10 in Fairbanks, dark; Kp block 06-09 UT is 1.33 in the 3-day text
const PLACES = {
  Fairbanks: { name: 'Fairbanks', latitude: 64.84, longitude: -147.72, admin1: 'Alaska', country: 'United States', country_code: 'US' },
  Miami: { name: 'Miami', latitude: 25.77, longitude: -80.19, admin1: 'Florida', country: 'United States', country_code: 'US' },
};
function cloudsBody(pct) {
  const t0 = Math.floor(NOW.getTime() / 3600000) * 3600 - 3600;
  const time = Array.from({ length: 100 }, (_, i) => t0 + i * 3600);
  return JSON.stringify({ timezone: 'America/Anchorage', utc_offset_seconds: -32400, hourly: { time, cloud_cover: time.map(() => pct) } });
}
// OVATION grid: 0 everywhere except 50% from 66 to 72 N at 212 E (148 W), just poleward of Fairbanks.
function ovationBody() {
  const coordinates = [];
  for (let lon = 0; lon < 360; lon++) for (let lat = -90; lat <= 90; lat++) coordinates.push([lon, lat, lon === 212 && lat >= 66 && lat <= 72 ? 50 : 0]);
  return JSON.stringify({ 'Observation Time': '2026-11-14T06:05:00Z', 'Forecast Time': '2026-11-14T06:50:00Z', coordinates });
}
let cloud = 5;
const f = async (u) => {
  if (u === KP_URL) return KP;
  if (u === THREE_DAY_URL) return THREE;
  if (u === ALERTS_URL) return ALERTS;
  if (u === OVATION_URL) return ovationBody();
  if (u.startsWith('https://geocoding-api.open-meteo.com/v1/search')) {
    const name = decodeURIComponent(/name=([^&]+)/.exec(u)[1]);
    return JSON.stringify({ results: PLACES[name] ? [PLACES[name]] : [] });
  }
  if (u.startsWith('https://api.open-meteo.com/v1/forecast')) return cloudsBody(cloud);
  throw new Error(`HTTP 404 (no fixture for ${u})`);
};

test('geomagnetic latitude, the Kp oval table and Kp formatting', () => {
  assert.ok(Math.abs(geomagneticLatitude(64.84, -147.72) - 65.6) < 0.5, 'Fairbanks about 65.6');
  assert.ok(geomagneticLatitude(-43.5, 172.6) < -45, 'Christchurch is south');
  assert.equal(ovalEdge(0), 66.5); assert.equal(ovalEdge(9), 48.1); assert.ok(Math.abs(ovalEdge(4.5) - 57.3) < 1e-9);
  assert.equal(fmtKp(3.33), '3+'); assert.equal(fmtKp(3.67), '4-'); assert.equal(fmtKp(5), '5');
  assert.equal(gScale(5), 'G1 minor storm'); assert.equal(gScale(9), 'G5 extreme storm'); assert.equal(gScale(2), 'quiet');
  assert.equal(kpNeeded(geomagneticLatitude(25.77, -80.19)).horizon, null);
});

test('the 3-day text fills the blocks the JSON forecast leaves out, with no gaps', () => {
  const json = parseKp(JSON.parse(KP));
  const text = parse3Day(THREE);
  assert.equal(text.length, 24);
  assert.equal(text[0].start.toISOString(), '2026-11-14T00:00:00.000Z'); assert.equal(text[0].kp, 1.67);
  const merged = mergeKp(json, text);
  for (let i = 1; i < merged.length; i++) assert.equal(merged[i].start - merged[i - 1].start, 3 * 3600000, `gap before ${merged[i].start.toISOString()}`);
  assert.throws(() => parseKp({}), UpstreamError);
});

test('judgeHour: daylight is never a sighting, a clear dark hour inside the oval is good, cloud spoils it', () => {
  const at = new Date();
  const s = { start: at, kp: 3, kind: 'predicted' };
  assert.equal(judgeHour(65, at, 10, s, 0).verdict, 'unlikely');
  assert.equal(judgeHour(65, at, -20, s, 0).verdict, 'good');
  assert.equal(judgeHour(55, at, -20, s, 0).verdict, 'possible');
  assert.equal(judgeHour(65, at, -20, s, 90).verdict, 'unlikely');
});

test('OVATION grid: lookup at the nearest point and the strongest value on the poleward horizon', () => {
  const o = parseOvation(JSON.parse(ovationBody()));
  assert.equal(ovationAt(o, 64.84, -147.72), 0); assert.equal(ovationPoleward(o, 64.84, -147.72), 50); assert.equal(ovationAt(o, 68, 212), 50);
  assert.throws(() => parseOvation({ coordinates: [] }), UpstreamError);
});

test('aurora tonight in Fairbanks: clear sky and Kp 1+ put it inside the oval, GOOD from 21:00 local', async () => {
  cloud = 5;
  const r = await auroraTonight(f, { location: 'Fairbanks, Alaska' }, NOW);
  assert.equal(r.verdict, 'GOOD'); assert.equal(r.place.name, 'Fairbanks, Alaska, United States');
  assert.equal(r.first_worthwhile_hour_local, '2026-11-13 22:00');
  assert.ok(r.hours.length >= 8); assert.ok(r.hours.every((h) => h.verdict === 'good'));
  assert.match(r.summary, /Verdict: GOOD chance/); assert.ok(r.more.includes(UTM));
});

test('aurora tonight under 90% cloud is UNLIKELY; Miami never sees it', async () => {
  cloud = 90;
  assert.equal((await auroraTonight(f, { location: 'Fairbanks' }, NOW)).verdict, 'UNLIKELY');
  cloud = 5;
  const m = await auroraTonight(f, { location: 'Miami' }, NOW);
  assert.equal(m.verdict, 'UNLIKELY'); assert.equal(m.kp_needed.horizon, null); assert.match(m.summary, /beyond Kp 9/);
});

test('aurora now in Fairbanks: 0% overhead, 50% on the northern horizon, dark and clear, GO LOOK', async () => {
  cloud = 5;
  const r = await auroraNow(f, { location: 'Fairbanks' }, NOW);
  assert.equal(r.ovation_overhead_percent, 0); assert.equal(r.ovation_horizon_percent, 50);
  assert.equal(r.kp.value, 1.33); assert.equal(r.kp.kind, 'predicted');
  assert.match(r.verdict, /^GO LOOK/); assert.ok(r.sun_altitude < -12);
});

test('Kp forecast: 3-hour blocks ahead, daily maximum 3+ on 2026-11-16', async () => {
  const r = await kpForecast(f, NOW);
  assert.ok(r.forecast.length >= 20);
  assert.deepEqual(r.daily_max.find((d) => d.date === '2026-11-16'), { date: '2026-11-16', max_kp: 3.33, display: '3+', scale: 'quiet' });
  assert.match(r.summary, /Daily maximum forecast Kp/);
});

test('space weather alerts: newest first within the window, geomagnetic filter, bad hours', async () => {
  const r = await spaceWeatherAlerts(f, { hours: 48 }, new Date('2026-11-14T12:00:00Z'));
  assert.ok(r.count >= 1); assert.equal(r.alerts[0].code, 'ALTEF3'); assert.equal(r.alerts[0].issued, '2026-11-14 05:03');
  const g = await spaceWeatherAlerts(f, { hours: 48, geomagnetic_only: true }, new Date('2026-11-14T12:00:00Z'));
  assert.ok(g.alerts.every((a) => a.code !== 'ALTEF3'));
  await assert.rejects(spaceWeatherAlerts(f, { hours: 500 }, NOW), InputError);
});

test('compare: Fairbanks ranks above Miami, an unknown place is reported, not fatal', async () => {
  cloud = 5;
  const r = await compareLocations(f, { locations: ['Miami', 'Fairbanks', 'Nowhereville'] }, NOW);
  assert.equal(r.ranking[0].place, 'Fairbanks, Alaska, United States'); assert.equal(r.ranking[1].good_hours, 0);
  assert.equal(r.not_found[0].location, 'Nowhereville');
  await assert.rejects(compareLocations(f, { locations: ['Miami'] }, NOW), InputError);
});

test('input errors: empty place, bad lat,lon, unknown place, too many nights', async () => {
  await assert.rejects(auroraTonight(f, { location: '' }, NOW), InputError);
  await assert.rejects(auroraTonight(f, { location: '95,10' }, NOW), InputError);
  await assert.rejects(auroraNow(f, { location: 'Nowhereville' }, NOW), InputError);
  await assert.rejects(auroraTonight(f, { location: 'Fairbanks', nights: 4 }, NOW), InputError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'aurora-forecast-kp-index-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['aurora_tonight', 'aurora_now', 'kp_forecast', 'space_weather_alerts', 'aurora_compare_locations']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'aurora_tonight', arguments: { location: 'Fairbanks', nights: 9 } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
