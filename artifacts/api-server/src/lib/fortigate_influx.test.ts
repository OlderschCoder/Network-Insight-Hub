import { describe, expect, it } from "vitest";
import {
  buildDeviceInterfaceRatesFlux,
  buildDeviceInterfacesFlux,
  buildDeviceTunnelsFlux,
  buildDeviceVlansFlux,
  formatNetworkDeviceTelemetryForFred,
  parseDeviceInterfaceRates,
  parseDeviceInterfaces,
  parseDeviceSummary,
  parseDeviceTunnels,
  parseDeviceVlans,
  parseInfluxCsv,
  projectFortiGateInterfacesToPorts,
} from "./fortigate_influx";

const annotated = `#group,false,false,false,false,false,false,false,false,false,false
#datatype,string,long,dateTime:RFC3339,long,string,string,string,string,string,string
#default,_result,,,,,,,,,
,result,table,_time,_value,_field,_measurement,source,sysName,ifName,index,phase1,phase2,vdom
,,0,2026-09-15T01:00:00Z,1,ifAdminStatus,fortigate_interface,172.25.0.1,WestCampus-Fortigate.sccc.edu,port1,1,,,
,,0,2026-09-15T01:00:00Z,2,ifOperStatus,fortigate_interface,172.25.0.1,WestCampus-Fortigate.sccc.edu,port1,1,,,
,,0,2026-09-15T01:00:00Z,98981,ifInErrors,fortigate_interface,172.25.0.1,WestCampus-Fortigate.sccc.edu,port1,1,,,
,,0,2026-09-15T01:00:00Z,0,ifOutErrors,fortigate_interface,172.25.0.1,WestCampus-Fortigate.sccc.edu,port1,1,,,
,,0,2026-09-15T01:00:00Z,1000,ifHighSpeed,fortigate_interface,172.25.0.1,WestCampus-Fortigate.sccc.edu,port1,1,,,
,,1,2026-09-15T01:00:00Z,2,status,fortigate_vpn_tunnel,172.25.0.1,WestCampus-Fortigate.sccc.edu,,7.Azure.Azure-Phase2.0.14,Azure,Azure-Phase2,0
,,1,2026-09-15T01:00:00Z,2048,inOctets,fortigate_vpn_tunnel,172.25.0.1,WestCampus-Fortigate.sccc.edu,,7.Azure.Azure-Phase2.0.14,Azure,Azure-Phase2,0
`;

describe("FortiGate Influx telemetry", () => {
  it("parses quoted annotated CSV and exposes measured port counters", () => {
    const csv = annotated.replace(
      "WestCampus-Fortigate.sccc.edu,port1",
      '"WestCampus-Fortigate.sccc.edu","port1"',
    );
    const rows = parseInfluxCsv(csv);
    const ports = parseDeviceInterfaces(rows);

    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({
      name: "port1",
      adminStatus: "up",
      operStatus: "down",
      speedMbps: 1000,
      inErrors: 98981,
      outErrors: 0,
    });
  });

  it("normalizes official Fortinet tunnel status values", () => {
    const tunnels = parseDeviceTunnels(parseInfluxCsv(annotated));

    expect(tunnels).toEqual([
      expect.objectContaining({
        phase1: "Azure",
        phase2: "Azure-Phase2",
        vdom: "0",
        index: "7.Azure.Azure-Phase2.0.14",
        status: "up",
        inOctets: 2048,
      }),
    ]);
  });

  it("builds bounded queries for live port and tunnel measurements", () => {
    const interfaces = buildDeviceInterfacesFlux("telegraf", "172.25.0.1");
    const rates = buildDeviceInterfaceRatesFlux("telegraf", "172.25.0.1");
    const vlans = buildDeviceVlansFlux("telegraf", "172.25.0.1");
    const tunnels = buildDeviceTunnelsFlux("telegraf", "192.168.1.1");

    expect(interfaces).toContain('"fortigate_interface"');
    expect(interfaces).toContain('r.source == "172.25.0.1"');
    expect(interfaces).not.toContain("|> last() |> group()");
    expect(interfaces).not.toContain('"ifPhysAddress"');
    expect(rates).toContain('"ifHCInOctets"');
    expect(rates).toContain('"ifHCOutOctets"');
    expect(rates).not.toContain('"ifInOctets"');
    expect(rates).not.toContain('"ifOutOctets"');
    expect(rates).toContain("|> tail(n: 2)");
    expect(rates).not.toContain("|> group()");
    expect(vlans).toContain('r._measurement == "fortigate_vlan"');
    expect(vlans).toContain('r._field == "fortigateVlanSnapshotMarker"');
    expect(vlans).toContain('"vlanName", "physicalInterface"');
    expect(vlans).not.toContain("|> last()");
    expect(tunnels).toContain('r._measurement == "fortigate_vpn_tunnel"');
    expect(tunnels).toContain('r.source == "192.168.1.1"');
  });

  it("does not invent a physical firewall port when IF-MIB type is absent", () => {
    const [port] = projectFortiGateInterfacesToPorts("node-1", [
      {
        name: "port1",
        description: null,
        ifIndex: 1,
        ifType: null,
        mtu: null,
        macAddress: null,
        adminStatus: "up",
        operStatus: "up",
        speedMbps: null,
        inErrors: null,
        outErrors: null,
        inDiscards: null,
        outDiscards: null,
        inOctets: null,
        outOctets: null,
        inBps: null,
        outBps: null,
        utilizationPct: null,
        allowedVlans: null,
        observedAt: "2026-09-15T01:00:00Z",
        measurement: "fortigate_interface",
      },
    ]);

    expect(port).toMatchObject({
      interfaceName: "port1",
      isPhysical: false,
      macCount: null,
      lldpNeighborCount: null,
      telemetryEvidence: "influx:fortigate_interface",
    });
  });

  it("joins the newest complete VLAN snapshot to exact parent interface names", () => {
    const snapshot = parseDeviceVlans([
      {
        _measurement: "fortigate_vlan",
        _field: "fortigateVlanSnapshotMarker",
        _value: "1",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        _measurement: "fortigate_vlan",
        _field: "vlanId",
        _value: "999",
        vlanName: "deleted-old-vlan",
        physicalInterface: "port1",
        _time: "2026-09-15T00:59:00Z",
      },
      {
        _measurement: "fortigate_vlan",
        _field: "vlanId",
        _value: "20",
        vlanName: "voice",
        physicalInterface: "PORT1",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        _measurement: "fortigate_vlan",
        _field: "vlanId",
        _value: "10",
        vlanName: "data",
        physicalInterface: "port1",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        _measurement: "fortigate_vlan",
        _field: "vlanId",
        _value: "777",
        vlanName: "unmarked-next-poll",
        physicalInterface: "port1",
        _time: "2026-09-15T01:01:00Z",
      },
    ]);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.byPhysicalInterface.get("port1")).toEqual([10, 20]);

    const interfaces = parseDeviceInterfaces(
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifType",
          _value: "6",
          _time: "2026-09-15T01:00:00Z",
        },
        {
          ifName: "port10",
          _measurement: "fortigate_interface",
          _field: "ifType",
          _value: "6",
          _time: "2026-09-15T01:00:00Z",
        },
      ],
      [],
      snapshot,
    );
    expect(interfaces).toEqual([
      expect.objectContaining({ name: "port1", allowedVlans: [10, 20] }),
      expect.objectContaining({ name: "port10", allowedVlans: [] }),
    ]);
    expect(
      projectFortiGateInterfacesToPorts("node-1", interfaces).map((port) => ({
        name: port.interfaceName,
        allowedVlans: port.allowedVlans,
      })),
    ).toEqual([
      { name: "port1", allowedVlans: [10, 20] },
      { name: "port10", allowedVlans: [] },
    ]);
  });

  it("accepts a current table marker with zero VLAN rows as an empty report", () => {
    const snapshot = parseDeviceVlans([
      {
        _measurement: "fortigate_vlan",
        _field: "fortigateVlanSnapshotMarker",
        _value: "1",
        _time: "2026-09-15T01:00:00Z",
      },
    ]);
    expect(snapshot).toMatchObject({
      complete: true,
      observedAt: "2026-09-15T01:00:00Z",
    });
    expect(snapshot.byPhysicalInterface.size).toBe(0);

    const [port] = parseDeviceInterfaces(
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifType",
          _value: "6",
          _time: "2026-09-15T01:00:00Z",
        },
      ],
      [],
      snapshot,
    );
    expect(port.allowedVlans).toEqual([]);
    const fredText = formatNetworkDeviceTelemetryForFred(
      {
        configured: true,
        reachable: true,
        host: "172.25.0.1",
        system: {
          uptime: null,
          cpuUsagePct: null,
          memoryUsagePct: null,
          sessionCount: null,
          observedAt: null,
        },
        pingLoss: null,
        rtt: null,
        pingObservedAt: null,
        interfaces: [port],
        tunnels: [],
        interfaceTelemetryAvailable: true,
        vlanTelemetryAvailable: true,
        tunnelTelemetryAvailable: false,
        lastPolled: "2026-09-15T01:00:00Z",
      },
      5,
    );
    expect(fredText).toContain("configuredVlanSubinterfaces=none reported");
  });

  it("keeps VLAN mappings unknown without a valid marker or with malformed current rows", () => {
    expect(parseDeviceVlans([]).complete).toBe(false);
    expect(
      parseDeviceVlans([
        {
          _measurement: "fortigate_vlan",
          _field: "vlanId",
          _value: "10",
          vlanName: "data",
          physicalInterface: "port1",
          _time: "2026-09-15T01:00:00Z",
        },
      ]).complete,
    ).toBe(false);
    const incomplete = parseDeviceVlans([
      {
        _measurement: "fortigate_vlan",
        _field: "fortigateVlanSnapshotMarker",
        _value: "1",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        _measurement: "fortigate_vlan",
        _field: "vlanId",
        _value: "5000",
        vlanName: "invalid",
        physicalInterface: "port1",
        _time: "2026-09-15T01:00:00Z",
      },
    ]);
    expect(incomplete.complete).toBe(false);
    const [port] = parseDeviceInterfaces(
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifType",
          _value: "6",
          _time: "2026-09-15T01:00:00Z",
        },
      ],
      [],
      incomplete,
    );
    expect(port.allowedVlans).toBeNull();

    expect(
      parseDeviceVlans([
        {
          _measurement: "fortigate_vlan",
          _field: "fortigateVlanSnapshotMarker",
          _value: "not-numeric",
          _time: "2026-09-15T01:00:00Z",
        },
      ]).complete,
    ).toBe(false);
  });

  it("calculates measured rates and utilization from two monotonic counter samples", () => {
    const rows = [
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHighSpeed",
        _value: "1000",
        _time: "2026-09-15T01:00:10Z",
      },
    ];
    const rateRows = [
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCInOctets",
        _value: "1000000000",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCInOctets",
        _value: "1125000000",
        _time: "2026-09-15T01:00:10Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCOutOctets",
        _value: "2000000000",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCOutOctets",
        _value: "2250000000",
        _time: "2026-09-15T01:00:10Z",
      },
    ];

    const [port] = parseDeviceInterfaces(rows, rateRows);

    expect(port).toMatchObject({
      inBps: 100_000_000,
      outBps: 200_000_000,
      utilizationPct: 20,
    });
  });

  it("keeps rates and utilization blank after a counter reset or with one sample", () => {
    const rates = parseDeviceInterfaceRates([
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCInOctets",
        _value: "500",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCInOctets",
        _value: "5",
        _time: "2026-09-15T01:00:10Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifHCOutOctets",
        _value: "900",
        _time: "2026-09-15T01:00:10Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifInOctets",
        _value: "100",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifInOctets",
        _value: "200",
        _time: "2026-09-15T01:00:10Z",
      },
    ]);
    expect(rates.get("fortigate_interface\u0000port1")).toEqual({
      inBps: null,
      inObservedAt: "2026-09-15T01:00:10Z",
      outBps: null,
      outObservedAt: "2026-09-15T01:00:10Z",
    });

    const [port] = parseDeviceInterfaces(
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHighSpeed",
          _value: "1000",
          _time: "2026-09-15T01:00:10Z",
        },
      ],
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCInOctets",
          _value: "500",
          _time: "2026-09-15T01:00:00Z",
        },
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCInOctets",
          _value: "5",
          _time: "2026-09-15T01:00:10Z",
        },
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCOutOctets",
          _value: "900",
          _time: "2026-09-15T01:00:10Z",
        },
      ],
    );
    expect(port).toMatchObject({
      inBps: null,
      outBps: null,
      utilizationPct: null,
    });
  });

  it("ignores legacy 32-bit counters and rejects stale direction rates", () => {
    const legacyOnly = parseDeviceInterfaceRates([
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifInOctets",
        _value: "100",
        _time: "2026-09-15T01:00:00Z",
      },
      {
        ifName: "port1",
        _measurement: "fortigate_interface",
        _field: "ifInOctets",
        _value: "200",
        _time: "2026-09-15T01:00:10Z",
      },
    ]);
    expect(legacyOnly.get("fortigate_interface\u0000port1")).toBeUndefined();

    const [port] = parseDeviceInterfaces(
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHighSpeed",
          _value: "1000",
          _time: "2026-09-15T01:00:10Z",
        },
      ],
      [
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCInOctets",
          _value: "100",
          _time: "2026-09-15T01:00:00Z",
        },
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCInOctets",
          _value: "200",
          _time: "2026-09-15T01:00:10Z",
        },
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCOutOctets",
          _value: "300",
          _time: "2026-09-15T00:59:59Z",
        },
        {
          ifName: "port1",
          _measurement: "fortigate_interface",
          _field: "ifHCOutOctets",
          _value: "400",
          _time: "2026-09-15T01:00:09Z",
        },
      ],
    );
    expect(port).toMatchObject({
      inBps: 80,
      outBps: null,
      utilizationPct: null,
    });
  });

  it("keeps SNMP and ping observation timestamps separate", () => {
    const summary = parseDeviceSummary([
      { _field: "fgSysCpuUsage", _value: "4", _time: "2026-09-15T01:00:00Z" },
      {
        _field: "percent_packet_loss",
        _value: "0",
        _time: "2026-09-15T01:04:00Z",
      },
    ]);

    expect(summary.system.observedAt).toBe("2026-09-15T01:00:00Z");
    expect(summary.pingObservedAt).toBe("2026-09-15T01:04:00Z");
  });

  it("tells Fred that absent tunnel evidence is unknown rather than zero", () => {
    const text = formatNetworkDeviceTelemetryForFred(
      {
        configured: true,
        reachable: true,
        host: "172.25.0.1",
        system: {
          uptime: 100,
          cpuUsagePct: 2,
          memoryUsagePct: 30,
          sessionCount: 1400,
          observedAt: "2026-09-15T01:00:00Z",
        },
        pingLoss: null,
        rtt: null,
        pingObservedAt: null,
        interfaces: [],
        tunnels: [],
        interfaceTelemetryAvailable: false,
        vlanTelemetryAvailable: false,
        tunnelTelemetryAvailable: false,
        lastPolled: "2026-09-15T01:00:00Z",
      },
      60,
    );

    expect(text).toContain("tunnel telemetry not collected");
    expect(text).toContain("do not interpret as zero tunnels");
    expect(text).toContain(
      "configured VLAN subinterfaces: complete current snapshot not collected",
    );
  });

  it("gives Fred the composite tunnel index and VDOM needed to distinguish selectors", () => {
    const text = formatNetworkDeviceTelemetryForFred(
      {
        configured: true,
        reachable: true,
        host: "172.25.0.1",
        system: {
          uptime: null,
          cpuUsagePct: null,
          memoryUsagePct: null,
          sessionCount: null,
          observedAt: "2026-09-15T01:00:00Z",
        },
        pingLoss: 0,
        rtt: 1.2,
        pingObservedAt: "2026-09-15T01:00:00Z",
        interfaces: [],
        tunnels: [
          {
            index: "7.Azure.Azure-Phase2.0.14",
            phase1: "Azure",
            phase2: "Azure-Phase2",
            vdom: "0",
            status: "up",
            inOctets: 2048,
            outOctets: 4096,
            observedAt: "2026-09-15T01:00:00Z",
          },
        ],
        interfaceTelemetryAvailable: false,
        vlanTelemetryAvailable: false,
        tunnelTelemetryAvailable: true,
        lastPolled: "2026-09-15T01:00:00Z",
      },
      5,
    );

    expect(text).toContain("index=7.Azure.Azure-Phase2.0.14");
    expect(text).toContain("vdom=0");
  });
});
