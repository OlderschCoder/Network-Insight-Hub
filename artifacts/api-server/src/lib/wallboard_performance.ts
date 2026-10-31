import type OpenAI from "openai";

export const WALLBOARD_PERFORMANCE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function", function: {
    name: "query_wallboard_performance",
    description: "Read actual SCCC Grafana TV wallboard performance from InfluxDB: building download/upload speed tests, main-campus WAN throughput by ISP, aggregate interface load, and wireless counts. Use for wallboard, bandwidth, throughput, Internet speed, and building performance questions. This retrieves measurements, not just a dashboard link or ping status. Includes source times and errors; never infer phone health from speed tests.",
    parameters: { type: "object", properties: {
      building: {type: "string", description: "Optional exact building name, case insensitive; omit for all."},
      hours: {type: "number", minimum: 1, maximum: 168, description: "Speed-test lookback; default 24 hours matches the TV wallboard."},
    } },
  },
};

export function parseFluxCsv(text: string): Record<string,string>[] {
  const lines: string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell="";}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))lines.push(row);row=[];cell="";}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);lines.push(row);}
  let header:string[]=[];const result:Record<string,string>[]=[];
  for(const values of lines){
    if(values[0]?.startsWith('#'))continue;
    if(values.includes('_value')&&(values.includes('result')||values.includes('table'))){header=values;continue;}
    if(header.length)result.push(Object.fromEntries(header.map((k,i)=>[k,values[i]??""])));
  }
  return result;
}

export function summarizeBuildingPerformance(rows: Record<string,string>[], now=Date.now()) {
  // Match the wallboard: last per building/computer/adapter, then mean by building.
  const latest=new Map<string,Record<string,string>>();
  for(const row of rows){
    const t=Date.parse(row._time),n=Number(row._value);
    if(!row.building||!row._value?.trim()||!Number.isFinite(t)||t>now||!Number.isFinite(n)||n<0||!['download_mbps','upload_mbps'].includes(row._field))continue;
    const key=JSON.stringify([row.building,row.computer,row.adapter,row._field]);
    if(!latest.has(key)||Date.parse(latest.get(key)!._time)<t)latest.set(key,row);
  }
  const groups=new Map<string,Record<string,string>[]>();
  for(const row of latest.values()){const group=groups.get(row.building)??[];group.push(row);groups.set(row.building,group);}
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([building,samples])=>{
    const metric=(field:string)=>{
      const selected=samples.filter(r=>r._field===field);
      if(!selected.length)return null;
      const times=selected.map(r=>Date.parse(r._time));const newest=Math.max(...times),oldest=Math.min(...times);
      return {mbps:selected.reduce((s,r)=>s+Number(r._value),0)/selected.length,sampleCount:selected.length,
        latestSampleAt:new Date(newest).toISOString(),oldestSampleAt:new Date(oldest).toISOString(),
        newestAgeMinutes:Math.round((now-newest)/60000),oldestAgeMinutes:Math.round((now-oldest)/60000),
        includesSamplesOlderThan12Hours:now-oldest>12*3600000};
    };
    return {building,download:metric('download_mbps'),upload:metric('upload_mbps')};
  });
}

export async function queryWallboardPerformance(raw: string) {
  const args=JSON.parse(raw||"{}");const requested=Number(args.hours);
  const hours=Number.isFinite(requested)?Math.max(1,Math.min(168,Math.round(requested))):24;
  const building=typeof args.building==='string'?args.building.trim().toLowerCase():"";
  const base=process.env.INFLUXDB_URL?.replace(/\/$/,""),token=process.env.INFLUXDB_TOKEN;
  if(!base||!token)return {status:"unavailable",error:"InfluxDB is not configured; no performance measurements retrieved."};
  const bucket=JSON.stringify(process.env.INFLUXDB_BUCKET||"telegraf");
  const from=`from(bucket: ${bucket})`;
  const queries={
    buildingSpeeds:`${from} |> range(start: -${hours}h) |> filter(fn: (r) => r._measurement == "sccc_device_performance" and (r._field == "download_mbps" or r._field == "upload_mbps")) |> filter(fn: (r) => r.type == "librespeed-v2" and r.method == "MultiStreamV2") |> group(columns: ["building","computer","adapter","_field"]) |> last() |> keep(columns: ["building","computer","adapter","_field","_time","_value"])`,
    mainCampusWan:`${from} |> range(start: -15m) |> filter(fn: (r) => r._measurement == "interface" and r.sysName == "FortigateA-Sccc.sccc.edu" and (r._field == "ifHCInOctets" or r._field == "ifHCOutOctets") and (r.ifName == "port25" or r.ifName == "port9")) |> derivative(unit: 1s, nonNegative: true) |> map(fn: (r) => ({_time:r._time, isp:if r.ifName == "port25" then "IdeaTek" else "United", _value:r._value*8.0})) |> group(columns:["_time","isp"]) |> sum(column:"_value") |> group(columns:["isp"]) |> last()`,
    backboneLoad:`${from} |> range(start: -10m) |> filter(fn: (r) => r._measurement == "interface_legacy" and (r._field == "ifInOctets" or r._field == "ifOutOctets")) |> derivative(unit:1s,nonNegative:true) |> last() |> map(fn:(r)=>({r with _value:r._value*8.0})) |> group(columns:[]) |> sum(column:"_value")`,
    wireless:`${from} |> range(start: -30m) |> filter(fn:(r)=>r._measurement == "aruba_wireless_summary" and contains(value:r._field,set:["aps_up","clients_total","authenticated_clients","guest_clients","sccc_wireless_clients","west_wireless_clients"])) |> group(columns:["_field"]) |> last() |> keep(columns:["_field","_time","_value"])`,
  };
  const data:Record<string,Record<string,string>[]>={},errors:Record<string,string>={};
  await Promise.all(Object.entries(queries).map(async([name,query])=>{
    try {
      const response=await fetch(`${base}/api/v2/query?org=${encodeURIComponent(process.env.INFLUXDB_ORG||"SCCC")}`,{
        method:"POST",headers:{Authorization:`Token ${token}`,"Content-Type":"application/vnd.flux",Accept:"application/csv"},body:query,signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error(`InfluxDB HTTP ${response.status}`);
      data[name]=parseFluxCsv(await response.text());
    }catch(error){errors[name]=error instanceof Error&&/^InfluxDB HTTP \d+$/.test(error.message)?error.message:"Performance query unavailable or timed out";}
  }));
  const now=Date.now();const buildings=summarizeBuildingPerformance(data.buildingSpeeds??[],now).filter(r=>!building||r.building.toLowerCase()===building);
  const numeric=(rows:Record<string,string>[])=>rows.filter(r=>r._value?.trim()&&Number.isFinite(Number(r._value))&&Number(r._value)>=0);
  return {
    status:Object.keys(errors).length?(Object.keys(data).length?"partial":"unavailable"):"ok",
    source:"InfluxDB telegraf — same measurements and aggregation as SCCC IT Operations Wallboard",
    dashboardUrl:"http://10.0.0.22:3000/d/sccc-it-tv-wallboard/sccc-it-tv-wallboard",
    retrievedAt:new Date(now).toISOString(),speedLookbackHours:hours,
    aggregation:"Mean of latest LibreSpeed MultiStreamV2 result per building, computer and adapter; Ethernet and Wi-Fi samples are combined, matching the wallboard.",
    buildings,mainCampusWan:numeric(data.mainCampusWan??[]).map(r=>({isp:r.isp,bitsPerSecond:Number(r._value),mbps:Number(r._value)/1e6,observedAt:r._time})),
    backboneLoadBitsPerSecond:numeric(data.backboneLoad??[])[0]?Number(numeric(data.backboneLoad)[0]._value):null,
    wireless:numeric(data.wireless??[]).map(r=>({metric:r._field,value:Number(r._value),observedAt:r._time})),errors,
    notes:["Missing data is unavailable, not zero.","Speed-test sample times can be older than retrieval time; report their age.","WAN figures combine inbound and outbound interface traffic, not measured Internet speed or link capacity.","Backbone load sums interface traffic and can count traffic across multiple hops; it is not total Internet bandwidth.","The Buildings page uses a different freshness and aggregation policy; its numbers may differ from this wallboard."],
  };
}
