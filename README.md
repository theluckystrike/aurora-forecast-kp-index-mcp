# aurora-forecast-kp-index-mcp

Aurora forecast and Kp index for AI assistants. Ask whether you can see the northern lights tonight from your town and get an hour-by-hour answer built from NOAA's predicted Kp index, the auroral oval, darkness and cloud cover, plus the live NOAA OVATION aurora probability and space weather alerts.

This is a Model Context Protocol (MCP) server. It reads NOAA Space Weather Prediction Center (SWPC) products and Open-Meteo cloud cover at call time and needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `aurora_tonight` | Hour by hour through the dark hours, for up to 3 nights: NOAA's predicted Kp, whether the auroral oval reaches overhead or the horizon at the place, cloud cover, and a good, possible or unlikely verdict with the first worthwhile hour. |
| `aurora_now` | The NOAA OVATION nowcast probability overhead and on the poleward horizon, the current Kp, darkness and cloud cover, with a go-look verdict. |
| `kp_forecast` | The planetary Kp index forecast in 3-hour UTC blocks with the NOAA G-scale storm level, the last 24 hours observed and the daily maximum. |
| `space_weather_alerts` | Recent NOAA SWPC alerts, watches and warnings, newest first, optionally geomagnetic only. |
| `aurora_compare_locations` | Ranks 2 to 10 places by tonight's good and possible dark hours, so you can choose where to drive. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=aurora-forecast-kp-index-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- Tonight's Kp. NOAA updates the forecast several times a day, and the JSON forecast leaves out the rest of the current UTC day, so the server fills those blocks from the SWPC 3-day forecast text.
- How far south the aurora reaches for a given Kp, from the NOAA oval table on a dipole geomagnetic latitude, and the Kp a place needs to see aurora on the horizon or overhead.
- Whether it is actually dark (sun 12 degrees below the horizon) and whether clouds will hide the sky.

## Install

### Hosted (Claude.ai custom connector, ChatGPT developer mode)

Paste this URL. No token, no sign-up.

```
https://aurora-forecast-kp-index-mcp.lipmichal.workers.dev/mcp
```

### Claude Code

```
claude mcp add --transport http aurora-forecast https://aurora-forecast-kp-index-mcp.lipmichal.workers.dev/mcp
```

### Claude Desktop

Claude Desktop adds remote servers under Settings, Connectors, Add custom connector. Paste the URL above.

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "aurora-forecast": { "url": "https://aurora-forecast-kp-index-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "aurora-forecast": { "type": "http", "url": "https://aurora-forecast-kp-index-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer.

```
git clone https://github.com/theluckystrike/aurora-forecast-kp-index-mcp && cd aurora-forecast-kp-index-mcp
npm install && npm run build
claude mcp add aurora-forecast -- node $(pwd)/dist/stdio.js
```

## Example prompts

- "Can I see the northern lights tonight in Fairbanks?"
- "What is the Kp index forecast for the next three days?"
- "Is the aurora visible right now in Tromso?"
- "Is there a geomagnetic storm watch?"
- "Which is better tonight for aurora, Duluth or Marquette?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- [NOAA SWPC planetary K-index forecast](https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json) and the [3-day forecast text](https://services.swpc.noaa.gov/text/3-day-forecast.txt).
- [NOAA SWPC OVATION aurora nowcast](https://services.swpc.noaa.gov/json/ovation_aurora_latest.json).
- [NOAA SWPC alerts](https://services.swpc.noaa.gov/products/alerts.json).
- [Open-Meteo](https://open-meteo.com/) hourly cloud cover and geocoding.

## Limitations

- The Kp-to-oval rule is NOAA's rule of thumb, not a guarantee. Aurora can appear further south during strong substorms and fail to appear at a forecast Kp.
- OVATION is a 30 to 90 minute nowcast on a 1-degree grid.
- Cloud cover is a model forecast for the nearest grid point.
- The hosted server caches SWPC products for 5 to 15 minutes.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=aurora-forecast-kp-index-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
