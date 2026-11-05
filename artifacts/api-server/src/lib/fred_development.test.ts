import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import { developmentRequest, executeFredDevelopment, FRED_DEVELOPMENT_ACTIONS } from "./fred_development";

describe("Fred coding authorization", () => {
  it("keeps rollback and arbitrary commands outside model tools, even for CIO", async () => {
    for (const action of ["rollback", "exec", "authorize"]) {
      await expect(executeFredDevelopment(JSON.stringify({action}), {id:1,role:"cio"})).rejects.toThrow("Unsupported development tool action");
    }
  });
  it("requires an exact revision before model publication", async () => {
    for (const revision of [undefined, "latest", "a".repeat(63)]) {
      await expect(executeFredDevelopment(JSON.stringify({action:"publish",revision}), {id:1,role:"cio"})).rejects.toThrow("Exact validated revision required");
    }
    expect(FRED_DEVELOPMENT_ACTIONS).toContain("publish");
  });
  it("forwards CIO publication to the existing validated release controller", async () => {
    let sent: any;
    const request = vi.spyOn(http, "request").mockImplementation((_options: any, callback: any) => ({
      on() { return this; },
      end(body: string) {
        sent=JSON.parse(body);
        callback({statusCode:200,on(event:string, handler:any) { if(event==="data")handler('{"status":"deploying"}');if(event==="end")handler();return this; }});
      },
    }) as any);
    try {
      expect(JSON.parse(await executeFredDevelopment(JSON.stringify({action:"publish",revision:"a".repeat(64)}),{id:1,role:"cio",name:"CIO"}))).toEqual({status:"deploying"});
      expect(sent).toEqual({action:"publish",revision:"a".repeat(64),actor:"1:CIO"});
    } finally { request.mockRestore(); }
  });
  it("rejects non-CIO publication before connecting", async () => {
    await expect(executeFredDevelopment(JSON.stringify({action:"publish",revision:"a".repeat(64)}),{id:2,role:"staff"})).rejects.toThrow("CIO access required");
  });
  it("rejects unauthenticated and non-CIO callers before connecting", async () => {
    for (const actor of [{id:null,role:"cio"},{id:2,role:"staff"},{id:3,role:"manager"}]) {
      await expect(developmentRequest({action:"write",path:"docs/test.md",content:"unauthorized"},actor)).rejects.toThrow("CIO access required");
    }
  });
});
