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
- Each conversation has an editable topic. A persistent topic dropdown in the
  Fred header lists the authenticated user's current and archived topics with
  message count and update date. The bold current topic appears first; prior
  topics are visually indented beneath it. Selecting one reactivates it with its
  messages and checkpoint intact. Starting a new topic archives the visible
  conversation; it does not erase governed memory.
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

Each successful CIO architecture run also creates an immutable row in
`fred_architecture_snapshots`. The row contains the full structured evidence
JSON—including every physical Port Map record—plus the count manifest,
human-readable report, independent review, generating models, author, and
timestamp. The Architecture tab exposes both Markdown and JSON downloads.

Fred reads the latest snapshot through `query_architecture_snapshot`. It must
query the normalized `fred_architecture_entities` and
`fred_architecture_relationships` projection by type, hostname, building, IP,
VLAN, application, or owner. This makes all captured evidence available over
multiple bounded retrievals without placing the multi-megabyte snapshot in
every model prompt.
With no filters, the tool returns only snapshot metadata, total element and
relationship counts, and counts by entity type. Relationship expansion occurs
only for filtered record queries, using JSON-array membership rather than
constructing an invalid PostgreSQL record cast.
Snapshot evidence remains historical: Fred must compare its timestamp with
live diagnostic tools before describing current operational state.

The projection includes buildings, monitored switches, map nodes, every
physical port, VLANs, topology links, routing adjacencies, phone-building
rollups, configuration facts, Azure resources, processes, and projects. Every
row retains its source, source timestamp, evidence status, snapshot ID, and
original structured attributes. Building containment, node-to-port, and
node-to-node topology relationships are first-class rows rather than prose.

When the CIO explicitly tells Fred to correct one exact element, Fred first
queries its natural key and then writes a minimal patch to
`fred_architecture_overrides`. The prior override is superseded, not deleted.
Queries overlay the latest correction while keeping the immutable generated
snapshot intact. Chat corrections never change live equipment or upstream
inventory, never accept secrets, and never outrank newer live evidence.

The CIO Dashboard contains a direct **SCCC Enterprise Architecture** button.
It opens the dedicated Architecture tab, not routine Fred chat, because report
generation and durable evidence capture are one governed operation.

The Architecture tab reloads the newest saved report, verification, snapshot
ID, and normalized record counts whenever it opens. A browser navigation or a
post-generation projection error therefore cannot hide a report whose immutable
snapshot was already committed. Projection input is deduplicated by entity type
and natural key before bulk insertion.

Network Inventory rows are monitored objects, not necessarily unique physical
switches. When one hostname has both a management address and an SVI address,
the normalized natural key includes the IP address so both records remain
queryable. The CIO Dashboard labels its 43/44-style rollup **Monitored Network
Objects** and notes that the count includes switches, management IPs, and SVIs.

Architecture chapter and verification calls use the lowest supported reasoning
overhead because factual evidence synthesis is already constrained by the
snapshot. This keeps refreshes below the reverse-proxy request window. If a
proxy timeout still occurs, the UI restores the latest committed snapshot and
does not clear the existing report while a refresh is running.

## Operations

After changing model variables or credentials, restart `sccc-api.service`. Verify
the API service is active and run API/frontend builds plus focused Fred tests.
