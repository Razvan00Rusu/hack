# Greenwave

A mocked traffic coordination demo in a synthetic Marylebone road network. Built with Next.js, React, TypeScript and SVG. No map token, API key, or external map service required. Google Fonts is optional; system fonts work offline.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Click **Close Oxford Street**, inspect a road or car, and use **Follow car** for an overhead satnav view. Try a directional block in the road inspector. Demand, playback speed, pause and reset are available. Coordinated mode uses congestion-aware shortest paths; all decision text is a local deterministic mock.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:ui
```

The UI test command starts its own local Next.js server. Install Chromium with `pnpm exec playwright install chromium` if needed.

See [the five-hour plan](docs/hackathon-plan.md) for scope, demo script, GPS comparison and simulation limits. See [Decisions API handoff](docs/decisions-api.md) for the verified request format and integration plan.

This is an illustrative map, not real London geometry. Fixed signals and simplified car following support a hackathon demo. The PoC does not call OpenAI or demonstrate measured superiority over commercial navigation. The 3D driving view and matched A/B experiment remain future work.

The metric cards include time-series charts sampled every simulated second. Vehicles and congested links are absolute counts; completed journeys and route changes show trailing 10-second counts with cumulative totals below. Orange markers identify closures, demand changes and routing mode changes. Hover a chart for a sampled value.

The vehicle inspector retains the original free-flow path, the initial recommendation and every reroute with its timestamp and reason. Dashed routes use distinct colours and small offsets to separate shared roads. Solid green is the current remaining route. Toggle individual layers in the inspector. Selected journeys remain inspectable after arrival, while they remain among the last 100 completed cars. Reset clears history and chart data.

Average journey time is the running mean duration of all completed trips, in simulated seconds. It is sampled alongside the other charts and remains blank until the first arrival. In-progress trips are excluded.
