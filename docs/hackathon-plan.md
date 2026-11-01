# Greenwave: five-hour build

Build a visible chain: incident → queue → junction decision → personalised diversion → network recovery.

## Schedule

| Time | Deliverable | Done when |
| --- | --- | --- |
| 0:00–0:45 | Fixed local road graph, neutral map, deterministic seed | Moving cars enter and leave the map |
| 0:45–1:45 | Capacity, signals, queues, directional closures | Cars cannot enter blocked directions; reverse traffic continues |
| 1:45–2:45 | Junction decision loop and Decisions API adapter | Choose among prevalidated routes; fall back on timeout or refusal |
| 2:45–3:45 | Route inspection, decision explanations, matched comparison | Same seed, demand, incident timing, and simulation horizon |
| 3:45–4:30 | Demo polish, scenario reset, measurements | One repeatable 90-second story |
| 4:30–5:00 | Bug fixes, rehearsal, offline fallback | Demo works without network access |

Current PoC covers the synthetic graph, simulation, closures, local routing policy, inspectors, and overhead follow mode. Routing and optional demand-based signal timing now support OpenAI Decisions and pinned TypeSafe Jev 1.13 through OpenRouter, independently. An initial headless, matched-demand screening suite and portable replay report now exist under reports/initial-pass. Longer repeated-seed and real-time-latency experiments remain future work. First-person driving is a stretch after the core demo is reliable.

## Why shared coordination helps

Live traffic and personalised routes already exist in navigation products. Do not pitch this as a feature those products lack. Pitch the experiment as an explicit shared objective across vehicles and signals in one controlled network.

- Allocate routes across spare capacity. Account for recommendations already issued, not just cars currently visible on each link.
- Personalise decisions by destination, vehicle class and constraints. Two vehicles at the same junction can receive different routes.
- Prevent queue spillback. Avoid sending a car into a full downstream link even when its destination is close.
- Protect residential streets. Add throughput limits or penalties; sending everyone down a side road is not success.
- Coordinate signal timing with route assignment. The optional Decisions signal experiment selects bounded green durations from local queues, wait times and traffic flow. Fixed timing remains the default comparison mode.
- Prioritise emergency vehicles or buses using an explicit policy. Keep ordinary drivers' maximum detours bounded.
- Show auditable reasons derived from measured queue lengths and chosen options.

With whole-network information, the local PoC combines occupancy with a simple reservation weight of 0.25 for each planned future link. Junction-only and neighbouring-road settings restrict occupancy inputs and omit network reservations. Route changes require a 15% estimated cost improvement, unless a closure invalidates the route. It has no residential budget, vehicle priority or fairness constraint yet. These are proposed additions, not demonstrated benefits.

## Comparison experiment

Keep an identical seed, entry demand schedule, closure at t=30s, and 180-second horizon. Run separate engines in lockstep. Compare free-flow shortest-path, independent congestion-aware routing, and shared coordination with planned-flow reservations. The UI offers shortest-path routing and coordinated routing through a local heuristic or either API provider, with configurable traffic visibility. Signal timing and its provider can vary independently. It is not a GPS benchmark.

Report completed trips, mean and p95 journey time, accumulated stopped seconds, maximum queue, local-road vehicle seconds, and reroutes per vehicle. Include unfinished journeys so gridlocked modes cannot appear faster by completing only easy trips. Freeze the experiment's demand and metric definitions. Report the result even if coordination loses.

## 90-second demo

1. Start with traffic flowing. Explain that cars have individual edge-to-edge destinations.
2. Click a car. Its remaining route appears in green.
3. Close Oxford Street. Vehicles already on the link clear it; upstream routes change.
4. Inspect a purple vehicle and its reason. Follow it through the overhead satnav view.
5. Click a side road to see every active vehicle whose route uses it.
6. Show the matched experiment once built, then discuss residential protection and detour fairness.

## Architecture

Render at display cadence. Step physics at a fixed 50ms. Compute routes locally on the directed graph. Each signal junction owns route reviews for vehicles on its incoming links. The routing controller supports once-per-approach requests or periodic reviews every 1, 4 or 10 simulated seconds, and junction-only, neighbouring-road or network traffic visibility. Independent junction questions due on the same step can share a request, with one typed route choice per vehicle. The local heuristic computes a route; either provider can select among locally validated candidate routes with observed occupancy and estimated costs. Residential and priority constraints remain future work. Validate its result against the latest closure and capacity state before applying it. Never ask the model to invent a street or perform each animation step.

Separate server routes handle signal timing and route selection through a shared provider adapter. They include input versioning, timeout, confidence handling, refusal handling, stale-result checks and local fallbacks. Closures must remain hard graph constraints regardless of model output.

## Simulation assumptions

The map is an illustrative warped grid named after Marylebone roads. It is not OpenStreetMap geometry. All links initially allow two-way traffic. One side blocked means one complete direction blocked, not a lane-capacity reduction. Cars follow with simple spacing and queue at alternating signals with 1-second all-red clearance; conflict-free turn movements, pedestrians and detailed junction physics are out of scope. Demand follows incident road capacities at boundary nodes. Vehicles already on a newly closed link finish that link. New entries cannot use it. Follow mode is overhead, not a 3D first-person camera.

Drive car adds third-person free driving with continuous steering and a live route minimap. Manual movement is independent of the graph; AI route recommendations never reposition the driver.
