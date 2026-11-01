# Decision provider integration

Verified on 1 November 2026 against the [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and [OpenRouter Jev guide](https://openrouter.ai/blog/tutorials/how-to-use-jev/).

## Providers

| Selection | Model | Endpoint | Server environment variable |
| --- | --- | --- | --- |
| OpenAI Decisions | `gpt-6-luna` | `https://api.openai.com/v1/decisions` | `OPENAI_API_KEY` |
| OpenRouter · Jev 1.13 | `typesafe/jev-1.13` | `https://openrouter.ai/api/alpha/decisions` | `OPENROUTER_API_KEY` |

`lib/decision-adapter.ts` translates a common set of evidence and choice questions into the provider's native protocol. OpenAI receives `input` and a questions array with `name`, `instructions` and `choices`. Jev receives the same evidence as `state` and a questions object keyed by those names, with `instructions` and `criteria` mapping choice values to descriptions. OpenAI's answers array and Jev's keyed answers are normalised before domain validation. No chat endpoint or model alias is used.

Both adapters use a 3-second wall-clock timeout and the same 0.6 confidence threshold. Confidence thresholds are experiment defaults; equality of thresholds does not imply equal calibration. Non-2xx responses, malformed answers, missing names, duplicate answers, refusals, unknown choices and low confidence fall back locally per question. Provider error bodies and credentials are never sent to the browser. The app caps route rounds at 200 questions for both providers.

## Routing

`app/api/route-decisions/route.ts` validates junction snapshots and calls `lib/route-decisions.ts`. Candidates are generated locally: current plan, congestion-aware shortest path, and an alternative avoiding the first outgoing link. Duplicate or closure-invalid paths are omitted. Vehicles with fewer than two legal candidates stay local. One choice question belongs to each remaining vehicle at its incoming signal. All questions in a batch share the same captured evidence.

The information controls apply equally to both providers. Local means occupancy on links touching the light. Neighbours extends that visibility through one adjacent junction. Network includes all occupancy plus 0.25 reservations for every planned future link. Every mode knows topology, closures and destinations; unknown road traffic uses free-flow costs.

Per-vehicle cadence reviews once on each approach. Periodic cadence reviews every 1, 4 or 10 simulated seconds, so vehicles may pass between reviews and waiting cars may be reviewed again. One round may be in flight; its requests run concurrently when junction batching is off. At most 200 vehicle questions enter a round, prioritising least recently reviewed vehicles. Initial recommendations and closure safety repairs always run locally.

Before applying an API answer the simulation checks request version, selected provider, current approach, unchanged route, closure version, legal offered path, finite confidence and snapshot age at most 5 simulated seconds. Reroutes require at least 15% estimated cost improvement using fresh observed traffic. Accepted provider answers can therefore leave the route unchanged. Stale or invalid answers use a fresh local route check. Cars that already left the approach ignore the answer. A missing key suspends API requests while local reviews continue; changing provider or settings permits retry.

## Signal timing

`app/api/signal-decisions/route.ts` validates local queue and flow observations and calls `lib/signal-decisions.ts` through the same provider transport. Signal information is independent of route visibility. Incoming counts, stopped queues, accumulated approach waiting seconds, longest queue wait and 10-second arrivals/departures are supplied per axis.

The fixed plan has EW/NS greens of 7/7 seconds. Allowed API choices are `balanced` with 7/7, `east_west` with 12/5 and `north_south` with 5/12. Both fixed and demand-based modes enforce 1 second all-red between opposing greens. API output changes upcoming green durations; it cannot interrupt an active green or bypass clearance. Both axes continue alternating.

Signals review every 4 simulated seconds with one batched request in flight while traffic is present. Responses over 5 simulated seconds old fall back to balanced timing. Accepted plans expire after 20 simulated seconds without refresh. Missing credentials suspend requests until the provider or mode changes. Fixed mode makes no signal requests.

## Manual experiments

Routing and signal providers are independent. Reset retains them along with routing mode, demand, visibility, cadence, batching and signal mode. Mode and provider changes mark the charts. Old responses cannot affect a changed provider or reset simulation. Inspector records retain provider, latency, answer source and fallback reasons. Templates explain applied choices without exposing chain of thought.

The app never silently fails over between paid providers. Local fallback remains attributed to the requested provider. Simulation time continues while requests run, so playback speed changes stale-response rates. Compare at the same speed and horizon, with the same demand and incident timing. Tests use mocked upstream responses; live access requires server credentials. The initial headless screening report uses fixed demand schedules and two decision barriers per run. The separate full-length study uses two demand seeds, staged incidents, 19 minutes of arrivals and a drain phase. Its 30-second decision barriers pause simulation time during requests and quota waits, so it measures policy outcomes. A real-time latency benchmark remains future work.

Both application API routes accept a validated `mapId`, defaulting to `central`. Candidate validation and signal-node validation use that map. The headless runner calls these same domain adapters directly and pauses simulated time while they run; it never mixes providers inside an arm.
