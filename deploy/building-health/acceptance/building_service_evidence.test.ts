import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({pool:{query:vi.fn()}}));
import { buildLatestBuildingPerformance, getBuildingServiceEvidence } from "./building_performance";
const now=Date.parse("2026-10-31T05:00:00Z");
const stamp=(hours=1)=>new Date(now-hours*3600000).toISOString();
const measurement=(download=100,upload=50)=>({adapterKind:"ethernet",downloadMbps:download,uploadMbps:upload,pingMs:20,jitterMs:1,transferClosed:true});
const speed=(extra:Record<string,unknown>={})=>({type:"librespeed-v2",error:null,libreSpeed:{serverOrigin:"https://denspeed.sharktech.net",serverId:92,method:"MultiStreamV2",measurements:[measurement()]},...extra});
const row=(data:Record<string,unknown>,hours=1,computer="PC-1")=>({building:"Agriculture",recorded_at:stamp(hours),computer_name:computer,data});
const result=(rows:ReturnType<typeof row>[])=>buildLatestBuildingPerformance(rows,now).Agriculture;
describe("building Internet evidence regression",()=>{
  it("retains validated external target provenance and reports an observed Internet path",()=>{
    const p=result([row(speed())]);expect(p.provenance.serverOrigin).toBe("https://denspeed.sharktech.net");
    expect(getBuildingServiceEvidence(p,now)).toMatchObject({internetUp:true,observedAt:stamp()});
  });
  it.each([13,-1])("does not report stale or future samples as up (%s hours)",(hours)=>{
    expect(getBuildingServiceEvidence(result([row(speed(),hours)]),now).internetUp).toBe(false);
  });
  it("rejects invalid timestamps and missing measurements",()=>{
    expect(getBuildingServiceEvidence(undefined,now).internetUp).toBe(false);
    const p=result([row(speed())]);expect(getBuildingServiceEvidence({...p,recordedAt:"invalid"},now).internetUp).toBe(false);
  });
  it.each(["failed","stale"])("does not promote an explicitly %s result",status=>{
    const p=result([row(speed())]);expect(getBuildingServiceEvidence({...p,status:status as any},now).internetUp).toBe(false);
  });
  it("rejects local-only data despite high throughput",()=>{
    const p=result([row({type:"fred",downloadMbps:900,uploadMbps:900})]);
    expect(getBuildingServiceEvidence(p,now).internetUp).toBe(false);
  });
  it.each(["https://localhost","https://192.168.1.1","http://speed.example.org","not-a-url"])("rejects invalid external HTTPS provenance %s",targetOrigin=>{
    const p=result([row({type:"external-quick",downloadMbps:100,external:{type:"external-quick",targetOrigin,httpStatus:200,bytesReceived:100,elapsedMs:10}})]);
    expect(getBuildingServiceEvidence(p,now).internetUp).toBe(false);
  });
  it("accepts a complete successful external HTTPS transfer",()=>{
    const p=result([row({type:"external-quick",downloadMbps:100,external:{type:"external-quick",targetOrigin:"https://probe.example.org",httpStatus:200,bytesReceived:100,elapsedMs:10}})]);
    expect(getBuildingServiceEvidence(p,now).internetUp).toBe(true);
  });
  it("does not treat an HTTP error as successful throughput",()=>{
    const p=result([row({type:"external-quick",downloadMbps:100,external:{type:"external-quick",targetOrigin:"https://probe.example.org",httpStatus:500,bytesReceived:100,elapsedMs:10}})]);
    expect(getBuildingServiceEvidence(p,now).internetUp).toBe(false);
  });
  it("does not refresh an old positive result with a recent zero-throughput sample",()=>{
    const zero=speed({libreSpeed:{serverOrigin:"https://denspeed.sharktech.net",serverId:92,method:"MultiStreamV2",measurements:[measurement(0,0)]}});
    expect(getBuildingServiceEvidence(result([row(speed(),23,"old"),row(zero,1,"new")]),now).internetUp).toBe(false);
  });
  it("lets a newer failure supersede the same endpoint's old success",()=>{
    expect(getBuildingServiceEvidence(result([row(speed(),2),row(speed({error:"timeout"}),1)]),now).internetUp).toBe(false);
  });
  it("rejects a wrong LibreSpeed destination and incomplete transfers",()=>{
    for(const patch of [{serverOrigin:"https://local.internal"},{serverId:123},{method:"other"},{measurements:[{...measurement(),transferClosed:false}]}]){
      const data=speed();data.libreSpeed={...data.libreSpeed,...patch};
      expect(getBuildingServiceEvidence(result([row(data)]),now).internetUp).toBe(false);
    }
  });
});
