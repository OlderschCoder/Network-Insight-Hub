import { describe, expect, it } from "vitest";
import { parseFredNocPingManyResponse } from "./fred_noc_ping_validation";

const targets = ["192.0.2.10", "SW-EDGE.EXAMPLE"];

describe("parseFredNocPingManyResponse", () => {
  it("accepts boolean results only for requested normalized targets", () => {
    const result = parseFredNocPingManyResponse(
      {
        operation: "ping_many",
        results: [
          { target: "192.0.2.10", reachable: false },
          { target: " sw-edge.example ", reachable: true },
        ],
      },
      targets,
    );

    expect(Object.fromEntries(result ?? [])).toEqual({
      "192.0.2.10": "down",
      "sw-edge.example": "up",
    });
  });

  it("turns a valid probe execution error into unknown", () => {
    const result = parseFredNocPingManyResponse(
      {
        operation: "ping_many",
        results: [
          {
            target: "192.0.2.10",
            reachable: false,
            error: "probe_timeout",
          },
        ],
      },
      ["192.0.2.10"],
    );

    expect(result?.get("192.0.2.10")).toBe("unknown");
  });

  it.each([
    ["missing reachable", { target: "192.0.2.10" }],
    ["non-boolean reachable", { target: "192.0.2.10", reachable: 0 }],
    ["non-string target", { target: 123, reachable: false }],
    ["unrequested target", { target: "192.0.2.99", reachable: false }],
    [
      "malformed error",
      { target: "192.0.2.10", reachable: false, error: { code: "timeout" } },
    ],
  ])("rejects a batch containing a %s result", (_label, entry) => {
    expect(
      parseFredNocPingManyResponse(
        { operation: "ping_many", results: [entry] },
        ["192.0.2.10"],
      ),
    ).toBeNull();
  });

  it("rejects conflicting duplicate results instead of using the last row", () => {
    expect(
      parseFredNocPingManyResponse(
        {
          operation: "ping_many",
          results: [
            { target: "SW-EDGE.EXAMPLE", reachable: true },
            { target: " sw-edge.example ", reachable: false },
          ],
        },
        ["sw-edge.example"],
      ),
    ).toBeNull();
  });

  it("fills omitted requested targets with unknown", () => {
    const result = parseFredNocPingManyResponse(
      {
        operation: "ping_many",
        results: [{ target: "192.0.2.10", reachable: true }],
      },
      targets,
    );

    expect(result?.get("192.0.2.10")).toBe("up");
    expect(result?.get("sw-edge.example")).toBe("unknown");
  });
});
