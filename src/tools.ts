// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, auroraNow, auroraTonight, compareLocations, kpForecast, spaceWeatherAlerts } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'aurora-forecast',
  metaDescription: 'MCP server for the aurora forecast and Kp index: northern lights chance tonight for any place, live NOAA OVATION aurora probability, the planetary Kp index forecast and space weather alerts.',
  intro: 'Aurora forecast and Kp index for AI assistants, read live from the NOAA Space Weather Prediction Center with cloud cover from Open-Meteo.',
};

export const TOOL_INFO = [
  { name: 'aurora_tonight', blurb: 'Can I see the northern lights tonight from a place? Hour by hour through the dark hours: predicted Kp, whether the auroral oval reaches overhead or the horizon, cloud cover and a verdict, for up to 3 nights.' },
  { name: 'aurora_now', blurb: 'Is the aurora visible right now? NOAA OVATION nowcast probability overhead and on the poleward horizon, current Kp, darkness and cloud.' },
  { name: 'kp_forecast', blurb: 'NOAA planetary Kp index forecast in 3-hour UTC blocks with the G-scale storm level, the last 24 hours observed and the daily maximum.' },
  { name: 'space_weather_alerts', blurb: 'Recent NOAA SWPC alerts, watches and warnings: geomagnetic storm watches, Kp warnings, radiation and radio blackout alerts.' },
  { name: 'aurora_compare_locations', blurb: 'Ranks up to 10 places by tonight\'s aurora chances so you can choose where to drive.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const LIVE = { ...RO, idempotentHint: false } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream NOAA SWPC or Open-Meteo error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };
const location = z.string().min(1).max(120).describe('Place like "Fairbanks, Alaska", "Tromso", "Reykjavik", "Minneapolis", or "lat,lon".');

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Aurora (northern and southern lights) forecast and the planetary Kp index, read at call time from NOAA SWPC, with cloud cover from Open-Meteo. ' +
      'A model cannot know tonight\'s Kp or the current aurora oval. Use aurora_tonight for "can I see the northern lights tonight in <place>", ' +
      'aurora_now for "is the aurora out right now", kp_forecast for the Kp index forecast and space_weather_alerts for geomagnetic storm watches. Cite NOAA SWPC.',
  });

  server.registerTool('aurora_tonight', {
    title: 'Northern lights forecast tonight',
    description:
      'Can I see the northern lights (or southern lights) tonight from a place? Hour by hour through the dark hours: NOAA\'s predicted Kp index, ' +
      'whether the auroral oval reaches overhead or the horizon there, cloud cover, and a good/possible/unlikely verdict with the best window. Up to 3 nights.',
    inputSchema: { location, nights: z.number().int().min(1).max(3).optional().describe('Nights ahead, 1 to 3. Default 1.') },
    annotations: { title: 'Aurora forecast tonight', ...LIVE },
  }, wrap((a: any) => auroraTonight(fetchText, a)));

  server.registerTool('aurora_now', {
    title: 'Aurora right now',
    description:
      'Is the aurora visible right now from a place? NOAA\'s OVATION nowcast probability overhead and on the poleward horizon (next 30 to 90 minutes), ' +
      'the current Kp index, whether it is dark and the current cloud cover.',
    inputSchema: { location },
    annotations: { title: 'Aurora right now', ...LIVE },
  }, wrap((a: any) => auroraNow(fetchText, a)));

  server.registerTool('kp_forecast', {
    title: 'Kp index forecast',
    description:
      'NOAA\'s planetary Kp index forecast for the next three days in 3-hour UTC blocks, with the NOAA G-scale storm level, plus the last 24 hours observed ' +
      'and the daily maximum. Kp 5 or more is a geomagnetic storm and pushes aurora toward mid latitudes.',
    inputSchema: {},
    annotations: { title: 'Kp index forecast', ...LIVE },
  }, wrap(() => kpForecast(fetchText)));

  server.registerTool('space_weather_alerts', {
    title: 'Space weather alerts',
    description:
      'Recent NOAA SWPC space weather alerts, watches and warnings: geomagnetic storm watches (aurora outlook), Kp warnings, solar radiation and radio blackout alerts, newest first.',
    inputSchema: {
      hours: z.number().int().min(1).max(168).optional().describe('Look back this many hours. Default 48.'),
      geomagnetic_only: z.boolean().optional().describe('Only geomagnetic (Kp, storm watch) messages. Default false.'),
    },
    annotations: { title: 'Space weather alerts', ...LIVE },
  }, wrap((a: any) => spaceWeatherAlerts(fetchText, a)));

  server.registerTool('aurora_compare_locations', {
    title: 'Compare aurora chances between places',
    description: 'Rank 2 to 10 places by tonight\'s aurora chances: good and possible dark hours, cloud, and the Kp needed, so you can choose where to drive.',
    inputSchema: { locations: z.array(z.string().min(1).max(120)).min(2).max(10).describe('Place names or "lat,lon" values.') },
    annotations: { title: 'Compare aurora chances', ...LIVE },
  }, wrap((a: any) => compareLocations(fetchText, a)));

  return server;
}
