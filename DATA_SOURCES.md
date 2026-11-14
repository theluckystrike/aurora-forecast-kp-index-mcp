# Data sources

All sources are public, keyless and read at call time. Test fixtures in `test/fixtures/` were downloaded on 2026-11-14.

| Data | URL | Notes |
|---|---|---|
| Planetary Kp index forecast | https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json | Observed, estimated and predicted Kp in 3-hour UTC blocks. Fixture covers 2026-11-07 to 2026-11-17. Cached 15 minutes. |
| SWPC 3-day forecast text | https://services.swpc.noaa.gov/text/3-day-forecast.txt | The "NOAA Kp index breakdown" table fills the current UTC day, which the JSON forecast leaves out. Fixture issued 2026 Nov 14 0030 UTC. |
| OVATION aurora nowcast | https://services.swpc.noaa.gov/json/ovation_aurora_latest.json | 360 x 181 grid of aurora probability, about 0.9 MB. Cached 5 minutes. |
| SWPC alerts, watches and warnings | https://services.swpc.noaa.gov/products/alerts.json | Cached 10 minutes. |
| Hourly cloud cover | https://api.open-meteo.com/v1/forecast?hourly=cloud_cover | Open-Meteo, CC BY 4.0. Cached 30 minutes. |
| Geocoding | https://geocoding-api.open-meteo.com/v1/search | Place name to lat/lon. Cached a day. |

NOAA data is a US government work and in the public domain. The auroral oval table (equatorward edge 66.5 degrees geomagnetic at Kp 0 to 48.1 at Kp 9) follows NOAA SWPC aurora viewing guidance. The geomagnetic pole is the IGRF-14 2025 dipole pole (80.8 N, 72.6 W).
