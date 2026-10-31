import http from "node:http";
import type OpenAI from "openai";

export const FRED_DEVELOPMENT_ACTIONS = ["status", "list", "read", "write", "replace", "diff", "validate", "prepare_release"] as const;
export function developmentRequest(input: Record<string, unknown>, actor: { id: number | null; role?: string | null; name?: string | null }): Promise<any> {
  if (actor.role !== "cio" || actor.id == null) return Promise.reject(new Error("CIO access required."));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...input, actor: `${actor.id}:${actor.name || "CIO"}` });
    const req = http.request({ socketPath: "/run/fred-development/control.sock", path: "/action", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 15000 }, response => {
      let data = "";
      response.on("data", chunk => { data += chunk; if (data.length > 400000) req.destroy(new Error("Development response exceeded limit.")); });
      response.on("end", () => { try { const result = JSON.parse(data); if (response.statusCode !== 200) reject(new Error(result.error || "Development request failed.")); else resolve(result); } catch (error) { reject(error); } });
    });
    req.on("timeout", () => req.destroy(new Error("Development controller timed out.")));
    req.on("error", error => reject(new Error(error.message.includes("ENOENT") ? "Development controller is unavailable." : error.message)));
    req.end(body);
  });
}

export const FRED_DEVELOPMENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function", function: {
    name: "develop_website",
    description: "CIO-authorized autonomous coding workspace for this website, including Fred's own application code and prompts. List/read files, make exact edits, inspect diff, run sandboxed builds and independent acceptance tests, and prepare a reviewable release. Work proactively on the requested change; do not merely describe code. Read before replacing and supply the returned sha256. Validation is asynchronous: call status later. Source edits do not change production. Credentials, auth/security, deployment machinery and baseline acceptance tests are protected. A CIO approves deployment separately in Fred's Development tab; this tool cannot publish, roll back, or authorize itself. Never invent a successful build or deployment.",
    parameters: { type: "object", properties: {
      action: {type:"string",enum:[...FRED_DEVELOPMENT_ACTIONS]}, path:{type:"string",description:"Repository-relative path; list accepts a prefix."},
      startLine:{type:"integer"},endLine:{type:"integer"},expectedSha256:{type:"string"},content:{type:"string",description:"Complete file content for write; omit expectedSha256 only for a new file."},
      find:{type:"string",description:"Exact unique old text for replace."},replacement:{type:"string"},summary:{type:"string",description:"What changed and measured validation results for the release."},
    },required:["action"] },
  },
};
export async function executeFredDevelopment(raw: string, actor: {id:number|null;role?:string|null;name?:string|null}) {
  const input = JSON.parse(raw);
  if (!FRED_DEVELOPMENT_ACTIONS.includes(input?.action)) throw new Error("Unsupported development tool action.");
  let result = await developmentRequest(input,actor);
  // Keep the agent's tool turn alive long enough to inspect test failures and fix them.
  if (input.action === "validate") {
    const id = result.id;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const state = await developmentRequest({action:"status"},actor);
      if (state.latest?.id === id && state.latest.status !== "running") { result=state.latest; break; }
    }
  }
  return JSON.stringify(result);
}
