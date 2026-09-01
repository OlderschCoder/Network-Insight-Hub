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
- Each conversation has an editable topic. Starting a new topic archives the
  visible conversation, and the Topics browser can reactivate it later with its
  messages and checkpoint intact; it does not erase governed memory.
- Browser state is timestamped and reconciled with the server copy. Navigation
  performs a keepalive save so a stale server response cannot overwrite a newer
  local transcript.
- Operational answers must prefer fresh application/tool evidence over stored narrative.

## Response behavior

Routine answers lead with the answer, delta, and action. Fred does not repeat the
question, narrate hidden reasoning, dump tool output, or append generic offers.
Long-form output is reserved for explicitly requested deliverables.

The transcript is confined to a fixed-height, permanently scrollable panel so
long conversations do not expand the entire application page. On desktop the
panel participates in the application shell's full flex-height chain: it reaches
the bottom content boundary and resizes with the browser viewport while the
header, topic controls, and composer remain visible.

Temporary incident topology is maintained separately from durable memory. Fred
extracts user-reported bypasses, disconnected paths, direct connections, and
restorations into a protected active-state block. The newest applicable change
overrides stored known-good topology during diagnosis until the user reports
that it has been restored or replaced; temporary state is never promoted to
permanent memory automatically.

## Enterprise architecture acceptance workflow

The CIO-only Architecture tab captures a timestamped evidence snapshot from the
network inventory/topology, every VLAN and reciprocal link, routing adjacencies,
building phone-assignment counts, safe VRF/VDOM/routing facts extracted from the
latest stored device configurations, summarized port telemetry, Azure resource inventory,
processes, projects, and governed knowledge. The configured deep model creates
an evidence-labelled as-is architecture with Mermaid diagrams. A separately configured model independently
checks unsupported claims, contradictions, stale evidence, confidence labels,
missing domains, and diagram defects. A generated document is not accepted merely
because it reads well; the verification verdict and evidence gaps remain attached.

The downloadable Markdown also receives deterministic appendices generated
directly from database rows. These include a completeness manifest, every
monitored object, every VLAN, every topology link with both ports, every routing
adjacency, per-building service coverage, and every physical Port Map interface.
The model cannot sample or omit these appendices; its narrative must reconcile
their exact counts and cover every building.

An explicit request for the current/as-is enterprise architecture in Ask Fred
is routed to this same complete generator rather than the routine 1,400-token
chat path. The report, coverage manifest, deterministic appendices, and
independent verification review are retained in the conversation topic. Later
turns send only a bounded architecture reference back to the model, preventing
the full deliverable from being retransmitted on every question.

## Operations

After changing model variables or credentials, restart `sccc-api.service`. Verify
the API service is active and run API/frontend builds plus focused Fred tests.
