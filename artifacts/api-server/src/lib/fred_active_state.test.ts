import { describe, expect, it } from "vitest";
import { extractActiveIncidentState } from "./fred_active_state.js";

describe("extractActiveIncidentState", () => {
  it("retains a user's temporary physical-path change", () => {
    const result = extractActiveIncidentState([
      { role: "user", content: "I disconnected the upstream and connected ScoreVision directly to port 1/1/13. This is a temporary bypass right now." },
      { role: "assistant", content: "Stored configuration says the uplink uses port 13." },
    ]);

    expect(result).toContain("disconnected the upstream");
    expect(result).toContain("temporary bypass");
    expect(result).not.toContain("Stored configuration");
  });

  it("keeps a newer restoration after an older bypass", () => {
    const result = extractActiveIncidentState(
      [{ role: "user", content: "The bypass is removed and the original uplink is restored." }],
      "Mark/team: We are temporarily bypassing the upstream switch.\nFred: use the stored topology.",
    );

    expect(result.split("\n").at(-1)).toContain("restored");
  });
});
