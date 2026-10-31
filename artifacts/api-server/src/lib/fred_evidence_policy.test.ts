import { describe, expect, it } from "vitest";
import { evidencePolicyFor, latestUserText } from "./fred_evidence_policy";

describe("Fred evidence policy", () => {
  it("requires corroboration for network and phone incidents", () => {
    expect(evidencePolicyFor("The gym has no Wi-Fi")?.minimumCalls).toBe(2);
    expect(evidencePolicyFor("Phones are down at Allied")?.toolNames).toContain("cisco_calling_support");
  });
  it("requires current Azure evidence", () => {
    expect(evidencePolicyFor("Is app-server2 down?")?.toolNames).toContain("query_azure_health");
  });
  it("does not force operational tools for ordinary conversation", () => {
    expect(evidencePolicyFor("Help me rewrite this paragraph")).toBeNull();
  });
  it("extracts text from the newest user content parts", () => {
    expect(latestUserText([{ role: "user", content: "old" }, { role: "assistant", content: "x" }, { role: "user", content: [{ type: "text", text: "new" }] }])).toBe("new");
  });
});
