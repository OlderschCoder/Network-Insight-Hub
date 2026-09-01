export const VOICE_E911_VLAN_MIN = 301;
export const VOICE_E911_VLAN_MAX = 322;

/**
 * CIO-validated SCCC voice/E911 ownership. VLANs not yet validated remain
 * Campus Wide so the Hub does not invent a physical-building relationship.
 */
export const VOICE_VLAN_BUILDING: Readonly<Record<number, string>> = {
  301: "Hobble",
  302: "Hobble",
  303: "Student Union / Student Activities",
  304: "Humanities",
  305: "Cosmetology",
  306: "Agriculture",
  307: "Student Living Center",
  308: "Student Living Center",
  309: "Student Living Center",
  310: "Tech Building B",
  311: "Maintenance Building",
  316: "Tech Building T",
  317: "Tech Building A",
  318: "Tech Building B",
  319: "Tech Building D",
  320: "Tech Building T",
  321: "Student Living Center",
  322: "Allied Health",
};

export type VoiceVlanAuthority = {
  type: "voice";
  building: string;
  verifiedBuilding: boolean;
};

export function voiceVlanAuthority(vlanId: number): VoiceVlanAuthority | null {
  if (vlanId < VOICE_E911_VLAN_MIN || vlanId > VOICE_E911_VLAN_MAX) return null;
  const building = VOICE_VLAN_BUILDING[vlanId];
  return {
    type: "voice",
    building: building ?? "Campus Wide",
    verifiedBuilding: Boolean(building),
  };
}
