/** Building service status is independent of switch/collector health.
 * CIO policy reaffirmed by Mark Bojeun, 2026-11-05: no building degradation
 * from missing measurements; down requires all three service checks to fail.
 */
export type ServiceCheck = {
  state: "up" | "down" | "unknown";
  observedAt: string | null;
};

export type BuildingHealthEvidence = {
  // Legacy false means not proven up, NOT proven down.
  internetUp?: boolean;
  observedAt?: string | null;
  internet?: ServiceCheck;
  externalWeb?: ServiceCheck;
  phones?: ServiceCheck;
};

export type CallingHealthEvidence = {
  configured: boolean;
  onlinePhoneOwners: number;
  assignedPhoneOwners?: number;
  offlinePhoneOwners?: number;
  unknownPhoneOwners?: number;
  noMatchedDevice?: number;
  observedAt?: string | null;
  error?: string;
};

export const BUILDING_HEALTH_GUIDANCE = `Building-service classification (current CIO policy): Never report service degradation without verified loss of service. Any degradation claim must name the affected service, the observed user or service impact, and the timestamp and source of the failure evidence. Never call a building degraded, attention-needed, or down because a switch, SVI, heartbeat, collector, configuration backup, or measurement is absent, stale, or failing. Keep device-level diagnostics and evidence gaps separate from building service status. Online assigned phones or successful external service evidence establish an operating service path, not proof that every service is healthy. A green building with no positive evidence means no confirmed building outage, not verified all services up. A building is down only when Internet, external web-page access, and assigned phones each have fresh explicit failure evidence and no current positive service evidence. A missing sample or false legacy internetUp flag is not a failed check. Follow healthAssessment and its evidence timestamps; do not reintroduce degraded wording from older prompts or conversation history.`;

const CHECK_FRESH_MS = 5 * 60_000;
const INTERNET_SAMPLE_FRESH_MS = 12 * 60 * 60_000;

function fresh(at: string | null | undefined, now: number, maxAge: number): boolean {
  const time = at ? Date.parse(at) : NaN;
  return Number.isFinite(time) && time <= now && now - time <= maxAge;
}

/** Pure shared rollup for building summaries, detail, monitoring, and Fred. */
export function assessBuildingHealth(
  evidence: BuildingHealthEvidence | null | undefined,
  calling?: CallingHealthEvidence | null,
  now = Date.now(),
) {
  const state = (check?: ServiceCheck) => check && fresh(check.observedAt, now, CHECK_FRESH_MS)
    ? check.state : "unknown";
  const internet = state(evidence?.internet);
  const externalWeb = state(evidence?.externalWeb);
  const phones = state(evidence?.phones);
  const measuredInternetUp = evidence?.internetUp === true &&
    fresh(evidence.observedAt, now, INTERNET_SAMPLE_FRESH_MS) &&
    // A newer explicit failure supersedes an older successful speed sample.
    !(internet === "down" && Date.parse(evidence.internet!.observedAt!) >= Date.parse(evidence.observedAt!));
  const callingCurrent = calling?.configured === true && !calling.error &&
    fresh(calling.observedAt, now, CHECK_FRESH_MS);
  const phonesUp = phones === "up" || (callingCurrent && calling.onlinePhoneOwners > 0);
  // Missing assignments, unmatched devices, unknowns, or API failures are never
  // proof that the assigned phones are down.
  const allAssignedPhonesDown = callingCurrent && (calling.assignedPhoneOwners ?? 0) > 0 &&
    calling.onlinePhoneOwners === 0 && calling.offlinePhoneOwners === calling.assignedPhoneOwners &&
    calling.unknownPhoneOwners === 0 && calling.noMatchedDevice === 0;
  const serviceObserved = measuredInternetUp || internet === "up" || externalWeb === "up" || phonesUp;
  const allServicesDown = !serviceObserved && internet === "down" && externalWeb === "down" &&
    (phones === "down" || allAssignedPhonesDown);
  const status = allServicesDown ? "down" : serviceObserved ? "operational" : "no_confirmed_outage";
  return {
    healthColor: allServicesDown ? "red" as const : "green" as const,
    status,
    serviceObserved,
    reason: allServicesDown
      ? "Internet, external web access, and assigned phones all have fresh explicit failure evidence."
      : serviceObserved
        ? "Service availability observed; device monitoring and missing measurements do not degrade the building."
        : "No confirmed building outage. Service evidence is incomplete; green is the policy default, not proof all services are up.",
    evidence: {
      internet: measuredInternetUp ? "up" : internet,
      externalWeb,
      phones: phonesUp ? "up" : allAssignedPhonesDown ? "down" : phones,
    },
    assessedAt: new Date(now).toISOString(),
  };
}
