# Greenwave

A traffic coordination experiment in a synthetic Marylebone road network. Built with Next.js, React, TypeScript and SVG. No map token, API key, or external map service required. Google Fonts is optional; system fonts work offline.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Click **Close Oxford Street**, inspect a road or car, and use **Follow car** for an overhead satnav view. Try a directional block in the road inspector. Demand, playback speed, pause and reset are available. Coordinated mode can use the local heuristic, OpenAI Decisions or TypeSafe Jev through OpenRouter. The default runs offline. Inspector explanations come from application templates and measured inputs.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:ui
```

The UI test command starts its own local Next.js server. Install Chromium with `pnpm exec playwright install chromium` if needed.

See [the five-hour plan](docs/hackathon-plan.md) for scope, demo script, GPS comparison and simulation limits. See [Decisions API handoff](docs/decisions-api.md) for the verified request format and integration plan.

This is an illustrative map, not real London geometry. Bounded alternating signals and simplified car following support a hackathon demo. Routing and signal timing have independent optional provider selectors for OpenAI and OpenRouter; no measured superiority over commercial navigation is claimed. The 3D driving view and matched A/B experiment remain future work.

The metric cards include time-series charts sampled every simulated second. Vehicles and congested links are absolute counts; completed journeys and route changes show trailing 10-second counts with cumulative totals below. Orange markers identify closures, demand changes and routing mode changes. Hover a chart for a sampled value.

The vehicle inspector retains the original free-flow path, the initial recommendation and every reroute with its timestamp and reason. Dashed routes use distinct colours and small offsets to separate shared roads. Solid green is the current remaining route. Toggle individual layers in the inspector. Selected journeys remain inspectable after arrival, while they remain among the last 100 completed cars. Reset clears history and chart data.

Average time on network is the mean elapsed age of all active vehicles, calculated as the sum of current simulation time minus each vehicle's birth time, divided by the active vehicle count. It includes cars waiting in traffic and updates before any journey finishes. Completed vehicles are excluded. The metric is blank when no vehicles are active and is measured in simulated seconds; it is not a predicted total journey duration.

Traffic load appears as thin bars outside each carriageway, with continuous green-to-red colours and smooth transitions. Road names appear once per named road on its centreline. Click a segment to independently block or reopen either compass direction. Red hatching and arrows mark only the blocked half; A/B markers connect the inspector controls to the selected endpoints. Use Open both or Close both for the whole link.

Traffic lights now own route reviews for vehicles on their incoming links. Decision requests offers three traffic information settings: occupancy on roads touching the light, occupancy extending through one neighbouring junction, or all occupancy plus planned-flow reservations. Every setting knows the static map, current closures and vehicle destinations. Unobserved roads use free-flow costs. Initial routes use free-flow routing; traffic-aware recommendations come from lights.

Request frequency can be once per vehicle per light approach, or periodic reviews every 1, 4 or 10 simulated seconds. Periodic reviews can miss vehicles that pass between requests and can review waiting vehicles again. Lights due on the same 50ms simulation step can share a mock request, with a separate typed route question for each approaching vehicle. With batching off, each light sends a separate request. Counters distinguish review batches, junction reviews and vehicle reviews. Provider latency can change which responses remain fresh. Select a light to see recent request snapshots and reviews, including unchanged routes.

Reset preserves decision settings and restarts seed 42. Settings changes are chart events. This supports manual runs with different information and cadence settings; an automated matched A/B experiment remains future work. Closure repairs always run locally, independently of request cadence, and are not counted as model requests. Local-heuristic batch counters describe simulated reviews. API routing and signal timing have separate counters for requests, accepted answers and fallbacks.

## Optional demand-based signal timing

Select **Signal timing → Signal controller → Demand-based · Decisions API** to use queue and traffic-flow evidence for timing. This experiment is independent of the routing mode and route-review information settings. The default is Fixed timing, which makes no signal API calls.

To enable live decisions, copy `.env.example` to `.env.local`, set `OPENAI_API_KEY`, and restart the dev server. The key stays on the server. The browser posts junction snapshots to `/api/signal-decisions`; the server uses the selected signal provider. For Jev, set `OPENROUTER_API_KEY` instead and select OpenRouter in Signal provider. See provider setup below.

Each light reports incoming vehicles, stopped queue size, accumulated stopped seconds on the current approach, longest current queue wait, and arrivals/departures over the last 10 simulated seconds. One batch reviews all lights every 4 simulated seconds while traffic is present, with at most one batch in flight. Signals always use local junction evidence. The route visibility and batching controls apply only to route reviews.

The API selects Balanced with 7s/7s greens, East/west priority with 12s/5s, or North/south priority with 5s/12s. Every phase change includes 1 simulated second of all-red clearance, in both fixed and demand-based modes. The active green completes before a new duration applies; both axes continue alternating. Map colours show east/west green, north/south green, or red clearance. The inspector reports the actual phase and requested upcoming green durations.

Responses must name the expected junction, choose an offered plan and have confidence at least 0.6. This threshold is an experiment default, not a calibrated guarantee. The server times out after 3 wall-clock seconds. Responses older than 5 simulated seconds are discarded. Plans expire after 20 simulated seconds without refresh. Missing credentials, refusals, malformed answers, low confidence, errors and timeouts use balanced timing at upcoming boundaries. A missing key stops further API requests until the experiment or provider is changed. Simulated time continues during requests, so higher playback speed can cause more stale responses.

For a manual comparison, select a routing mode, demand and signal controller, then Reset to restart the seed with those settings. Reset preserves demand and routing as well as decision and signal settings. Apply the same incidents at the same simulated times and compare at the same horizon. The Signal timing panel reports stopped vehicles, accumulated stopped vehicle seconds, request batches, accepted junction answers and fallbacks. Select a light to inspect its queue measurements and recent API results. Accepted counts include unchanged balanced answers; request batches count browser requests even when the server has no key. This is a manual experiment, not the automated matched-demand benchmark in the build plan. These timing rules belong to this simplified simulation and are not a real-world signal controller.

## Compare decision providers

Copy `.env.example` to `.env.local` and set either or both server-side keys, then restart the dev server:

```dotenv
OPENAI_API_KEY=your_openai_key
OPENROUTER_API_KEY=your_openrouter_key
```

No key belongs in a `NEXT_PUBLIC_` variable. These selectors are independent:

- **Decision requests → Routing provider**: Local heuristic, OpenAI Decisions, or OpenRouter · Jev 1.13. API routing operates in Coordinated mode; Shortest path makes no routing API calls.
- **Signal timing → Signal provider**: OpenAI Decisions or OpenRouter · Jev 1.13. It is used when Signal controller is demand-based; Fixed timing makes no signal API calls.

OpenAI uses `gpt-6-luna` at `https://api.openai.com/v1/decisions`. OpenRouter uses the exact pinned model `typesafe/jev-1.13` at `https://openrouter.ai/api/alpha/decisions`. Jev uses `state` and named questions with `criteria`, not chat completions. Both providers receive equivalent evidence and allowed choices. Their returned confidences share a 0.6 acceptance threshold for this experiment, but that does not establish equal calibration or accuracy.

API routing uses `/api/route-decisions`. Each light prepares the current route, a congestion-aware route and an alternative avoiding the current first outgoing link, omitting duplicate or blocked paths. Vehicles with fewer than two legal choices stay local and are omitted from provider questions. The provider selects one offered value per vehicle. Before applying it, the engine verifies the vehicle is still on the same approach, its route has not changed, the closure version is current, the snapshot is at most 5 simulated seconds old, the route remains legal and a reroute improves current estimated cost by at least 15%. Otherwise the engine keeps the route or uses a fresh local fallback. A provider choice can be accepted without causing a reroute.

API routing permits at most 200 vehicle questions per review round, prioritising vehicles reviewed least recently if demand exceeds that cap. One round may be in flight at a time. Batching puts its junctions into one request; disabling batching sends separate requests for those junctions. Information scope and cadence still control the evidence and review schedule. Missing credentials suspend further API attempts while local heuristic reviews continue. Reselect the provider after configuring its key. Initial recommendations and closure safety repairs remain local in every mode.

Provider changes are chart events and invalidate old responses. Reset preserves both providers, route settings, signal mode, demand and routing mode. Inspect a light to see the actual provider, accepted answers or fallback reasons and provider latency. No automatic cross-provider fallback occurs: a failing Jev run stays labelled Jev and falls back locally, never silently to OpenAI. For an A/B comparison, change one selector, Reset, use the same demand, incidents and horizon, and include latency and fallbacks in the result. Automated matched-demand runs remain future work. Unit and browser tests mock upstream responses; live access needs configured keys.

## Initial benchmark report

Open [the initial HTML report](reports/initial-pass/report.html) for the summary charts, scenario filters and three-way recorded playback. It is a portable, self-contained file and makes no API calls when viewed. [Metrics CSV](reports/initial-pass/metrics.csv), [full results JSON](reports/initial-pass/results.json) and [API audit](reports/initial-pass/api-audit.jsonl) accompany it.

The interactive lab now has a **City map** selector. Central London retains the 42-node, 71-link, 11-signal grid. The illustrative suburban map has 17 nodes, 20 links and three signals, with longer corridors, mostly T-junctions and access spurs. Both maps use the same simulation and provider adapters.

The headless screening suite uses immutable per-scenario demand schedules, FIFO entry queues and identical incidents across algorithms. Its 90 short runs cover two maps, low/mid/high demand, open/one-way-blocked/fully-blocked roads, and five independent arms: shortest/fixed, OpenAI/fixed, Jev/fixed, OpenAI/own-AI signals and Jev/own-AI signals. No run mixes the paid providers. Cars waiting outside the map and unfinished journeys count in the metrics.

Each run lasts 75 simulated seconds, with demand through 45 seconds and only two AI decision checkpoints at 20 and 40 seconds. Simulation pauses while decisions are fetched, so this is a decision-quality screen, not a real-time latency benchmark. One seed and a short horizon do not establish a robust ranking. Composite scores and all underlying metrics are documented in the report.

```sh
pnpm benchmark:initial
pnpm benchmark:report
pnpm exec tsx scripts/verify-report.ts
```

The first command makes paid calls, loads `.env.local` and resumes checkpointed completed arms. It refuses to overwrite completed results; move the existing `reports/initial-pass` directory before deliberately repeating the suite. The second and third commands make no API calls. The initial complete suite requires at most 216 requests; the saved pass used 219 benchmark requests because a floating-point signal-telemetry validation bug interrupted one arm after three calls. Two preflight requests are recorded separately. API audit records include partial usage and costs where supplied, without headers or credentials. Future attempts have explicit request and payload budgets and stop without publishing incomplete arms if those budgets are exhausted.

## Full-length journey-time study

The longer study is stored separately in `reports/full-length`; the initial report is preserved. Its headline is average time from **scheduled departure to actual arrival**, including external entry queues, shown as a percentage change against shortest path. Shortest path is 0%; negative is faster. Own-AI signal timing is the report's default comparison, with fixed-signal routing controls still available.

The full protocol covers both maps, arrival rates of 1.5/3/6 vehicles per simulated second, six incident designs, two demand seeds and five independent arms: 360 runs. The old low-demand level is removed. Each run has a 300s warm-up, staged changes at 300/480/660/840s, and continued demand until 1140s. The final five minutes of demand are after all restrictions reopen. Conditions include single full or directional blocks, overlapping full closures, mixed full/one-way closures, and reversing directional restrictions.

After arrivals stop, every scheduled vehicle must finish, including those waiting outside the map. Runs that have no completions for 300s after demand has ended for at least 300s stop as gridlock timeouts. A 7200s total cap catches slow-progress/pathological cases. A no-API drain probe found an extra-high baseline cleared at 5588.9s, so the original 3600s cap was extended uniformly; earlier cap-limited runs were archived and rerun. Incomplete runs have no all-trip journey-time average; completed-only averages are labelled partial and excluded from the headline. The report shows comparison coverage and completion outcomes for every condition.

```sh
pnpm benchmark:full
pnpm benchmark:full:report
pnpm exec tsx scripts/full/verify.ts
```

The runner uses separate resumable per-arm files and exact same-provider response caching. Routing and signal questions due together are combined at 30s simulated-time barriers. The full study uses a 40s signal-plan lifetime so plans remain valid between those barriers; the interactive lab retains its original 4s cadence and 20s lifetime. Simulation time pauses during calls and quota waits, so this study isolates decision-policy outcomes rather than real-time API delays.

Native requests are audited without credentials. A quota-aware broker limits concurrency, paces OpenAI token usage and permits at most two paced retries for HTTP 429 responses. Early rate-limited arm attempts are quarantined and rerun; their audit/cost overhead is retained. Other service failures produce explicit local fallbacks. The report includes stability diagnostics rather than assuming that high or extra-high traffic reaches equilibrium.

An audit of the preserved initial data found identical raw fixed-signal metrics in 14/18 OpenAI/Jev pairs, identical one-decimal scores in 15/18, and agreement on 410/418 jointly accepted first-checkpoint choices. This is expected under the shared locally costed candidate set and 15% improvement guard, not shared provider wiring. `reports/full-length/routing-audit.json` contains the evidence and a near-threshold example. The new report therefore defaults to comparing complete routing-plus-signal systems while retaining the fixed-signal control.
