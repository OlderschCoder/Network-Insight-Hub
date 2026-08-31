# Fred model routing, memory, and architecture generation

Fred uses explicit workload profiles rather than one model for every request.

| Profile | Default model | Purpose |
| --- | --- | --- |
| routine | `openai/gpt-5.6-terra` | Concise staff chat, evidence tools, and memory capture |
| deep | `openai/gpt-5.6-sol` | Enterprise architecture and long-form synthesis |
| verify | `openai/gpt-5.6-terra` | Independent acceptance review |

Claude Opus 5 remains the preferred cross-provider candidate for the deep profile,
but it must not be enabled until OpenRouter reports a ZDR-compatible endpoint for
the account. The defaults can be changed with `FRED_ROUTINE_MODEL`, `FRED_DEEP_MODEL`, and
`FRED_VERIFY_MODEL`. When `OPENROUTER_API_KEY` is unavailable, Fred falls back
to the existing direct OpenAI integration and `FRED_DIRECT_MODEL`.

## Privacy and governance

- OpenRouter must be configured for Zero Data Retention and prompt logging must remain disabled.
- Secrets are never written to AI memory or chat documentation.
- Team and personal memories remain distinct.
- Durable conversations are stored per authenticated user in `fred_chat_sessions`.
- Starting a new chat archives the visible conversation; it does not erase governed memory.
- Operational answers must prefer fresh application/tool evidence over stored narrative.

## Response behavior

Routine answers lead with the answer, delta, and action. Fred does not repeat the
question, narrate hidden reasoning, dump tool output, or append generic offers.
Long-form output is reserved for explicitly requested deliverables.

## Enterprise architecture acceptance workflow

The CIO-only Architecture tab captures a timestamped evidence snapshot from the
network inventory/topology, summarized port telemetry, Azure resource inventory,
processes, projects, and governed knowledge. Claude Opus 5 creates an evidence-
labelled as-is architecture with Mermaid diagrams. A separately configured model independently
checks unsupported claims, contradictions, stale evidence, confidence labels,
missing domains, and diagram defects. A generated document is not accepted merely
because it reads well; the verification verdict and evidence gaps remain attached.

## Operations

After changing model variables or credentials, restart `sccc-api.service`. Verify
the API service is active and run API/frontend builds plus focused Fred tests.
