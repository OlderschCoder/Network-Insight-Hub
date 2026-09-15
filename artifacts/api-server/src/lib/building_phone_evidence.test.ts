import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn() },
}));

import { phoneConnectivityStatus } from "./building_health";
import {
  collectBuildingPhoneEvidence,
  isPhysicalPhoneLikeDevice,
} from "./building_phone_evidence";
import { fetchAllWebexDevices } from "./webex_support";

const observedAt = "2026-09-14T18:00:00.000Z";

describe("building phone evidence", () => {
  it("counts physical phone hardware but excludes Webex software clients", () => {
    expect(isPhysicalPhoneLikeDevice({ product: "Cisco 8841" })).toBe(true);
    expect(isPhysicalPhoneLikeDevice({ type: "MPP", model: "CP-8865" })).toBe(
      true,
    );
    expect(isPhysicalPhoneLikeDevice({ displayName: "Lobby ATA" })).toBe(true);
    expect(
      isPhysicalPhoneLikeDevice({
        product: "Webex App",
        displayName: "Mark's phone",
      }),
    ).toBe(false);
    expect(isPhysicalPhoneLikeDevice({ type: "Desktop Client" })).toBe(false);
    expect(isPhysicalPhoneLikeDevice({ product: "Room Kit" })).toBe(false);
  });

  it("marks a building incomplete when an assigned owner has no matched physical phone", () => {
    const evidence = collectBuildingPhoneEvidence(
      [
        { webex_person_id: "owner-a", building: "Mansions" },
        { webex_person_id: "owner-b", building: "Mansions" },
      ],
      [
        {
          personId: "owner-a",
          product: "Cisco 8841",
          connectionStatus: "disconnected",
        },
        {
          personId: "owner-b",
          product: "Webex App",
          connectionStatus: "disconnected",
        },
      ],
      observedAt,
      true,
    ).get("Mansions");

    expect(evidence).toMatchObject({
      total: 1,
      online: 0,
      offline: 1,
      unknown: 0,
      assignedOwners: 2,
      matchedOwners: 1,
      complete: false,
    });
    expect(phoneConnectivityStatus(evidence)).toBe("unknown");
  });

  it("reports phone-down only when all assigned owners have known offline physical phones", () => {
    const evidence = collectBuildingPhoneEvidence(
      [
        { webex_person_id: "owner-a", building: "Student Living A&B" },
        { webex_person_id: "owner-b", building: "Mansions" },
      ],
      [
        {
          personId: "owner-a",
          product: "Cisco 8841",
          connectionStatus: "disconnected",
        },
        { workspaceId: "owner-b", type: "IP Phone", status: "offline" },
      ],
      observedAt,
      true,
    ).get("Mansions");

    expect(evidence).toMatchObject({
      total: 2,
      offline: 2,
      assignedOwners: 2,
      matchedOwners: 2,
      complete: true,
    });
    expect(phoneConnectivityStatus(evidence)).toBe("down");
  });

  it("preserves separate authoritative dorm and tech buildings while resolving legacy Mansions aliases", () => {
    const evidence = collectBuildingPhoneEvidence(
      [
        { webex_person_id: "dorm-g", building: "Student Living G" },
        { webex_person_id: "tech-a", building: "Tech Building A" },
        { webex_person_id: "mansions", building: "Student Living A&B" },
      ],
      [
        { personId: "dorm-g", product: "Cisco 8841", connectionStatus: "connected" },
        { personId: "tech-a", product: "Cisco 8841", connectionStatus: "connected" },
        { personId: "mansions", product: "Cisco 8841", connectionStatus: "connected" },
      ],
      observedAt,
      true,
    );

    expect(evidence.has("Student Living G")).toBe(true);
    expect(evidence.has("Tech Building A")).toBe(true);
    expect(evidence.has("Mansions")).toBe(true);
    expect(evidence.has("Student Living Center")).toBe(false);
    expect(evidence.has("Industrial Technology Campus")).toBe(false);
  });

  it("fails closed when a matched physical phone has an unknown state or the source is partial", () => {
    const assignments = [{ webex_person_id: "owner-a", building: "Mansions" }];
    const device = {
      personId: "owner-a",
      product: "Cisco 8841",
      connectionStatus: "unknown",
    };
    const unknown = collectBuildingPhoneEvidence(
      assignments,
      [device],
      observedAt,
      true,
    ).get("Mansions");
    const partial = collectBuildingPhoneEvidence(
      assignments,
      [{ ...device, connectionStatus: "disconnected" }],
      observedAt,
      false,
    ).get("Mansions");

    expect(unknown).toMatchObject({ unknown: 1, complete: false });
    expect(partial).toMatchObject({ offline: 1, complete: false });
    expect(phoneConnectivityStatus(unknown)).toBe("unknown");
    expect(phoneConnectivityStatus(partial)).toBe("unknown");
  });

  it("follows trusted Webex device pagination to completion", async () => {
    const fetchPage = vi
      .fn<(pathname: string) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "one" }] }), {
          headers: {
            Link: '<https://webexapis.com/v1/devices?cursor=two>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "two" }] })),
      );

    const result = await fetchAllWebexDevices(fetchPage);

    expect(result).toEqual({
      devices: [{ id: "one" }, { id: "two" }],
      complete: true,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(1, "/devices?max=1000");
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      "https://webexapis.com/v1/devices?cursor=two",
    );
  });

  it("keeps partial results incomplete when the next page is untrusted", async () => {
    const fetchPage = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [{ id: "one" }] }), {
          headers: {
            Link: '<https://example.com/devices?cursor=two>; rel="next"',
          },
        }),
    );

    await expect(fetchAllWebexDevices(fetchPage)).resolves.toEqual({
      devices: [{ id: "one" }],
      complete: false,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("marks the result incomplete when the pagination safety limit is reached", async () => {
    const fetchPage = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [{ id: "one" }] }), {
          headers: {
            Link: '<https://webexapis.com/v1/devices?cursor=two>; rel="next"',
          },
        }),
    );

    await expect(fetchAllWebexDevices(fetchPage, 1)).resolves.toEqual({
      devices: [{ id: "one" }],
      complete: false,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
