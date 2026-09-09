import { describe, expect, it } from "vitest";
import { buildingOverlayPutSchema } from "./network_nodes";

describe("building map layout validation", () => {
  it("accepts encoded custom-building codes longer than 20 characters", () => {
    const result = buildingOverlayPutSchema.safeParse({
      positions: [
        {
          code: "CUSTOM:Industrial%20Technology%20Campus",
          x: 42.5,
          y: 18.25,
        },
        {
          code: "CUSTOM:Student%20Activities",
          x: 64,
          y: 31,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("still rejects an overlay code that exceeds the storage-safe limit", () => {
    const result = buildingOverlayPutSchema.safeParse({
      positions: [{ code: "x".repeat(201), x: 50, y: 50 }],
    });

    expect(result.success).toBe(false);
  });
});
