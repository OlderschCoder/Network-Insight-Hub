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
  octet counters;
- `fortigate_vpn_tunnel` for Phase 1/Phase 2 identity, Fortinet status, and
  in/out octets.

Tunnel rows use Telegraf's composite SNMP `index` tag as their measured row
identity. Fortinet's Phase 2 index object is not directly readable and is not
invented as a separate field.

The existing general `interface` series remains compatible during collector
rollout, but only directly observed columns are displayed. Utilization and
optics remain blank until the collector measures them.

Fred's current-status lookup defaults to the same five-minute window as the
authenticated device page. A longer lookback is used only when the operator
explicitly asks a historical last-seen question, so an old `up` sample is not
quietly presented as current health.

Firewall telemetry is operational context, not a building-anchor designation.
Fred must not turn either FortiGate into a building's main switch unless an
operator separately configures that topology relationship. The FortiGate REST
API token used by Network Tools is also unrelated to this read-only SNMP path.
