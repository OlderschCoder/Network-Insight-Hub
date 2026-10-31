import { describe, expect, it } from "vitest";
import { developmentRequest, executeFredDevelopment } from "./fred_development";

describe("Fred coding authorization", () => {
  it("rejects release operations from model tools, even for CIO", async () => {
    for (const action of ["publish", "rollback", "exec", "authorize"]) {
      await expect(executeFredDevelopment(JSON.stringify({action}), {id:1,role:"cio"})).rejects.toThrow("Unsupported development tool action");
    }
  });
  it("rejects unauthenticated and non-CIO callers before connecting", async () => {
    for (const actor of [{id:null,role:"cio"},{id:2,role:"staff"},{id:3,role:"manager"}]) {
      await expect(developmentRequest({action:"write",path:"docs/test.md",content:"unauthorized"},actor)).rejects.toThrow("CIO access required");
    }
  });
});
