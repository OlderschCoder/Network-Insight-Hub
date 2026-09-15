import { describe, expect, it } from "vitest";
import {
  INCOMPLETE_WEBEX_DEVICE_INVENTORY_ERROR,
  prepareWebexSupportDeviceInventory,
} from "./webex_support";

describe("Webex support device inventory", () => {
  it("maps and sorts a complete multi-page collection", () => {
    expect(
      prepareWebexSupportDeviceInventory({
        complete: true,
        devices: [
          {
            id: "two",
            displayName: "Zulu phone",
            product: "Cisco 8841",
            connectionStatus: "disconnected",
            personId: " person-two ",
          },
          {
            id: "one",
            name: "Alpha phone",
            type: "MPP",
            connectionStatus: "connected",
            workspaceId: " room-one ",
          },
        ],
      }),
    ).toEqual({
      error: null,
      devices: [
        {
          id: "one",
          name: "Alpha phone",
          product: "MPP",
          status: "online",
          personId: null,
          workspaceId: "room-one",
        },
        {
          id: "two",
          name: "Zulu phone",
          product: "Cisco 8841",
          status: "offline",
          personId: "person-two",
          workspaceId: null,
        },
      ],
    });
  });

  it("discards partial rows instead of presenting them as authoritative totals", () => {
    expect(
      prepareWebexSupportDeviceInventory({
        complete: false,
        devices: [{ id: "page-one-only", connectionStatus: "connected" }],
      }),
    ).toEqual({
      devices: [],
      error: INCOMPLETE_WEBEX_DEVICE_INVENTORY_ERROR,
    });
  });
});
