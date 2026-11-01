# Decisions API handoff

Verified against the [official Decisions API guide](https://developers.openai.com/api/docs/guides/decisions) on 1 November 2026. The PoC makes no OpenAI calls and needs no API key.

The documented endpoint is POST https://api.openai.com/v1/decisions with model `gpt-6-luna`. Choice questions accept fixed `value` and `description` options. The answer includes `choice`, `confidence` and a probability distribution, or a refusal. Independent junction questions can share a request.

Example request body for a future server-side adapter:

```json
{
  "model": "gpt-6-luna",
  "input": "Synthetic junction J17, snapshot version 81. Candidate routes have already been checked for connectivity and closures. Choose for this vehicle's destination. Balance journey time and expected downstream occupancy. Keep detour below 60 seconds and respect residential capacity. Candidate A: 95 seconds, downstream occupancy 91%. Candidate B: 112 seconds, occupancy 40%, residential budget available.",
  "questions": [
    {
      "type": "choice",
      "name": "vehicle_42_route",
      "instructions": "Which validated route best satisfies the stated network policy?",
      "choices": [
        { "value": "route_a", "description": "Main road, 95 seconds, 91% occupancy." },
        { "value": "route_b", "description": "Alternative road, 112 seconds, 40% occupancy, within residential budget." }
      ]
    }
  ]
}
```

The numbers above are illustrative, not measured results. Generate candidates locally. Keep the key on the server. Before applying an answer, check that its value was offered, that the snapshot is still relevant, and that no closure appeared. On failure, timeout, refusal or insufficient confidence, use the local validated route.

Use templates for UI reasons, such as "Oxford Street is closed. Divert via Weymouth Street." Those are application explanations based on evidence and selected options, not model chain of thought. The current mock feed labels every entry as a mock policy decision.
