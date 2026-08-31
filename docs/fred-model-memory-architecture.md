# Fred model routing, memory, and architecture generation

Fred uses explicit workload profiles rather than one model for every request.

| Profile | Default model | Purpose |
| --- | --- | --- |
| routine | `gpt-5.6-terra` | Concise staff chat, evidence tools, and memory capture through direct OpenAI |
| deep | `gpt-5.6-sol` | Enterprise architecture and long-form synthesis through direct OpenAI |
| verify | `gpt-5.6-terra` | Independent acceptance review through direct OpenAI |

Claude Opus 5 remains the preferred cross-provider candidate for the deep profile,
but it must not be enabled until OpenRouter reports a ZDR-compatible endpoint for
the account. The defaults can be changed with `FRED_ROUTINE_MODEL`, `FRED_DEEP_MODEL`, and
`FRED_VERIFY_MODEL`. When `OPENROUTER_API_KEY` is unavailable, a configured
non-OpenAI profile falls back to the direct OpenAI integration and
`FRED_DIRECT_MODEL`.

OpenAI model IDs, including IDs written with an optional `openai/` prefix, are
always sent directly to `api.openai.com` with `OPENAI_API_KEY`. OpenRouter is
used only for explicitly configured non-OpenAI model IDs such as
`anthropic/claude-opus-5` or `google/...`.

GPT-5.6 function-tool calls through Chat Completions explicitly use
`reasoning_effort: none`, as required by the direct OpenAI endpoint. Fred's
evidence gathering and tool loop remain enabled.

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

Temporary incident topology is maintained separately from durable memory. Fred
extracts user-reported bypasses, disconnected paths, direct connections, and
restorations into a protected active-state block. The newest applicable change
overrides stored known-good topology during diagnosis until the user reports
that it has been restored or replaced; temporary state is never promoted to
permanent memory automatically.

## Enterprise architecture acceptance workflow

The CIO-only Architecture tab captures a timestamped evidence snapshot from the
network inventory/topology, summarized port telemetry, Azure resource inventory,
processes, projects, and governed knowledge. The configured deep model creates
an evidence-labelled as-is architecture with Mermaid diagrams. A separately configured model independently
checks unsupported claims, contradictions, stale evidence, confidence labels,
missing domains, and diagram defects. A generated document is not accepted merely
because it reads well; the verification verdict and evidence gaps remain attached.

## Operations

After changing model variables or credentials, restart `sccc-api.service`. Verify
the API service is active and run API/frontend builds plus focused Fred tests.
