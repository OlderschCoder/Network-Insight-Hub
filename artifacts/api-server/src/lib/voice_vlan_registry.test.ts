import { describe, expect, it } from "vitest";
import { voiceVlanAuthority } from "./voice_vlan_registry";

describe("SCCC voice/E911 VLAN authority", () => {
  it("maps CIO-verified building VLANs", () => {
    expect(voiceVlanAuthority(303)).toEqual({
      type: "voice",
      building: "Student Union / Student Activities",
      verifiedBuilding: true,
    });
    expect(voiceVlanAuthority(322)?.building).toBe("Allied Health");
  });

  it("keeps unverified voice VLANs campus wide", () => {
    expect(voiceVlanAuthority(312)).toEqual({
      type: "voice",
      building: "Campus Wide",
      verifiedBuilding: false,
    });
    expect(voiceVlanAuthority(315)?.building).toBe("Campus Wide");
  });

  it("does not classify VLANs outside the governed range", () => {
    expect(voiceVlanAuthority(300)).toBeNull();
    expect(voiceVlanAuthority(323)).toBeNull();
  });
});
