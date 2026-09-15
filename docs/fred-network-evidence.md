# Fred network evidence workflow

Fred treats freshly captured console output as live evidence, regardless of whether it arrived through an API, pasted chat text, or an attached text file. She compares what the command actually proves with the stored configuration baseline, current topology and monitoring, and the reciprocal end of each relevant link.

For link and reachability incidents, Fred evaluates the endpoint or SVI, local access port and VLAN, local uplink or aggregate, the upstream device's reciprocal interface, downstream dependencies, and at least one independent service signal. Interface-up alone is insufficient when the expected neighbor or reciprocal state disagrees.

The response must distinguish verified facts, conflicts, and inference, then provide the likely fault domain, safest discriminating test, recommended fix, validation, and rollback. Fred performs authorized read-only checks before replying. She asks the user only for physical work, an approval-gated change, or evidence unavailable through the application and selected console material.

## FortiGate telemetry

Telegraf on the NOC host continuously polls both edge firewalls into InfluxDB:
Main Campus at `192.168.1.1` and West at `172.25.0.1`. Fred's bounded
`query_influx_last_seen` tool can retrieve the latest observed `sysUpTime`,
`fgSysCpuUsage`, `fgSysMemUsage`, and `fgSysSesCount` fields for either address,
along with ping loss or latency when present. A missing field stays missing; Fred
does not infer CPU, memory, sessions, or availability from inventory.

The authenticated firewall detail page uses the same Influx source. **Port
Map** projects current IF-MIB rows only when their measured `ifType` identifies
an Ethernet interface; it does not manufacture a faceplate from the model name.
**VPN Tunnels** lists current FortiGate Phase 2 selectors, composite selector
index, status, traffic counters, VDOM, and observation time. If the NOC collector has not produced the
dedicated interface or tunnel measurements, the page says telemetry has not
arrived. An empty query is never presented as zero ports or zero tunnels.
The interactive page uses a five-minute evidence window; unmatched saved
interfaces remain visible as inventory but their live-only fields are blank.

The API reads these dedicated measurements:

- `fortigate_interface` for IF-MIB identity, state, errors, discards, speed, and
  octet counters. The API uses only the two newest monotonic 64-bit
  `ifHCInOctets` and `ifHCOutOctets` samples to calculate measured in/out bits
  per second; it never falls back to wrapping 32-bit counters. Each direction's
  newest sample must have the exact timestamp of the current interface table
  before it is attached. Peak directional utilization additionally requires
  both current directions and the speed observed in the current evidence
  window;
- `fortigate_vlan` for configured VLAN subinterface name, VLAN ID, and exact
  physical parent interface;
- `fortigate_vpn_tunnel` for Phase 1/Phase 2 identity, Fortinet status, and
  in/out octets.

The `fortigate_vlan` table includes a numeric
`fortigateVlanSnapshotMarker` field built from a scalar `sysUpTime` prefix at
the synthetic index zero. Telegraf emits that marker and all reported VLAN rows
from one successful table build with one exact table timestamp. The API selects
the newest marker and only `vlanId` rows at that timestamp. A marker plus valid
rows proves the reported mapping: a matched parent receives its sorted VLAN IDs
and another physical parent receives an empty, “none reported” list. A marker
with zero VLAN rows is also a complete empty report. A failed table build emits
neither the marker nor partial rows. No marker, a malformed marker, or a
malformed current VLAN row leaves VLAN mapping unknown. Parent names must match
exactly after case normalization; the API does not use prefixes, port numbers,
or model assumptions.

The production NOC collector was verified on 2026-09-15 at 16:44 UTC after a
Telegraf-only deployment. Main reported one current marker with five aligned
VLAN rows on `port7` and `port8`; West reported one current marker with zero
rows. Five recent 64-bit counter sample times covered 65 Main interfaces and 17
West interfaces, and Telegraf remained running and healthy. The protected NOC
rollback backup is
`/home/ITADMIN/sccc-ops/backups/telegraf/20260915T163856Z-west-fortigate`.

Interface queries keep each Flux field in its typed result table through CSV
parsing. Names and descriptions are strings while state and counters are
numeric; combining them into one Flux table creates a schema collision and
must be treated as a failed query, never as an empty port map.
The API does not request the binary SNMP `ifPhysAddress` value because raw
octets are not safe annotated CSV; a missing MAC address therefore stays
unknown instead of risking a partially parsed port map.

Tunnel rows use Telegraf's composite SNMP `index` tag as their measured row
identity. Fortinet's Phase 2 index object is not directly readable and is not
invented as a separate field.

The existing general `interface` series remains compatible during collector
rollout, but only directly observed columns are displayed. Utilization remains
blank when either direction lacks two high-capacity samples, a counter resets,
a direction is not timestamp-aligned to the current interface table, or current
speed evidence is absent. Optics remains blank until the collector measures DOM
values.

Fred's current-status lookup defaults to the same five-minute window as the
authenticated device page. A longer lookback is used only when the operator
explicitly asks a historical last-seen question, so an old `up` sample is not
quietly presented as current health.

Firewall telemetry is operational context, not a building-anchor designation.
Fred must not turn either FortiGate into a building's main switch unless an
operator separately configures that topology relationship. The FortiGate REST
API token used by Network Tools is also unrelated to this read-only SNMP path.
