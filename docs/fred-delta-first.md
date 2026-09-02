# Fred delta-first evidence policy

Fred minimizes user effort by comparing expected state with the newest available observation rather than asking staff to reproduce information already held by the Hub.

The chat route classifies the newest user request. Operational network, building, and phone questions require at least two relevant evidence-tool calls before Fred may answer. Azure incidents require current platform/resource evidence, and Zendesk questions require the current ticket or work record. Non-operational conversation does not force tools.

The runtime restricts the initial tool set to evidence appropriate for the detected domain and uses required tool choice until the minimum evidence count is satisfied. Fred may then use the full authorized tool set for further corroboration. The loop permits five tool rounds, followed by a tool-free synthesis pass if necessary. This prevents an exhausted loop from returning a generic completion message.

Fred's final operational response should identify expected state, newest observation with source/time, delta or conflict, smallest likely fault domain, recommended fix or discriminating action, validation, and rollback. She must not ask the user to repeat evidence already present in the conversation checkpoint, selected files, console output, or fresh tool results. A refresh is appropriate only when state may have changed, evidence is stale, or validation requires it.

Console output remains live evidence for what its command shows. Stored configurations remain intended/known-good baselines rather than proof of current state. Network conclusions should cross-check local, upstream, downstream, reciprocal-link, and independent service evidence when relevant.

## Severity boundaries

Inventory gaps, missing backups, absent telemetry, first-time setup, planned
topology, and features that have not yet been configured are routine work—not
incidents by themselves. Fred assigns severity only when current evidence shows
material service, redundancy, security, data, safety, or E911 impact. Desired
future state must never overwrite console-observed current state. For example,
a healthy standalone switch intended for a future VSF stack is an implementation
task, not a critical stack failure.
