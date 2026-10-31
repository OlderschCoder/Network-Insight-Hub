import { pool } from "@workspace/db";
import { upsertVlanByVlanId } from "../lib/inventory";
import { VOICE_E911_VLAN_MAX, VOICE_E911_VLAN_MIN, voiceVlanAuthority } from "../lib/voice_vlan_registry";

const results: Array<{ vlanId: number; building: string; ok: boolean; result: string }> = [];

try {
  for (let vlanId = VOICE_E911_VLAN_MIN; vlanId <= VOICE_E911_VLAN_MAX; vlanId += 1) {
    const authority = voiceVlanAuthority(vlanId)!;
    const outcome = await upsertVlanByVlanId(
      { vlanId, building: authority.building, type: authority.type },
      { actor: { id: null, name: "Mark Bojeun — authoritative voice/E911 correction" }, source: "manual" },
    );
    results.push({
      vlanId,
      building: authority.building,
      ok: outcome.ok,
      result: outcome.ok ? outcome.result : outcome.error,
    });
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await pool.end();
}
