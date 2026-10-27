import { describe,expect,it } from 'vitest';
import { capable,reporting,deviceSlot,capacitySlots,chicagoWindow,staggerSeconds,selectCapacityProbe,throughputOptions,chooseTransferLane,PENDING_POLL_SECONDS,STAGGER_SECONDS,type TransferLane } from './building_probe_scheduler';
import { heartbeatInput,PROBE_SCHEMA,resultSchema,THROUGHPUT_PROFILES } from './building_probe_protocol';
import { randomUUID } from 'node:crypto';
describe('bounded probe clock and priority',()=>{
  it('keeps the immediate lightweight baseline separate and anchors bulk checks to activation',()=>{
    const activation=Date.parse('2026-10-25T15:03:17Z');
    expect(deviceSlot('pc',2,new Date(activation),activation)).toBeNull();
    expect(deviceSlot('pc',2,new Date(activation),activation+301000)?.slotAt).toBe('2026-10-25T15:08:17.000Z');
    expect(deviceSlot('pc',2,new Date(activation),activation+3601000)?.profile).toBe('hourly');
    expect(deviceSlot('pc',2,new Date(activation),activation+550000)?.late).toBe(true);
    expect(deviceSlot('pc',2,null,activation)).toBeNull();
  });
  it('changes slot identity for a new selection revision, preserving an already elapsed slot',()=>{
    const activation='2026-10-25T15:00:00Z',now=Date.parse(activation);
    expect(deviceSlot('pc',1,activation,now+300000)?.key).not.toBe(deviceSlot('pc',2,activation,now+300000)?.key);
    expect(deviceSlot('pc',1,activation,now+29*60000+1000)?.late).toBe(true);
  });
  it('keeps 07:00 and 19:00 Chicago wall-clock windows across both DST changes',()=>{
    expect(new Date(chicagoWindow('2026-03-07',7)).toISOString()).toBe('2026-03-07T13:00:00.000Z');
    expect(new Date(chicagoWindow('2026-03-08',7)).toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(new Date(chicagoWindow('2026-10-31',19)).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(new Date(chicagoWindow('2026-11-01',19)).toISOString()).toBe('2026-11-02T01:00:00.000Z');
  });
  it('uses stable per-building offsets within 45 minutes and one DST-stable key per window',()=>{
    const id=randomUUID(),offset=staggerSeconds(id),window=chicagoWindow('2026-10-25',7);
    expect(offset).toBe(staggerSeconds(id));expect(offset).toBeGreaterThanOrEqual(0);expect(offset).toBeLessThan(STAGGER_SECONDS);
    expect(capacitySlots(id,window+offset*1000)).toHaveLength(1);
    const slot=capacitySlots(id,window+offset*1000)[0]!;
    expect(slot.late).toBe(false);expect(slot.windowEndsAt).toBe(new Date(window+2700000).toISOString());
    expect(capacitySlots(id,window+3600000)[0]).toMatchObject({key:slot.key,late:true});
  });
  it('alternates only eligible explicitly selected capable probes',()=>{
    const now=Date.now(),base={enabled:true,selected:true,device_id:randomUUID(),last_seen:new Date(now),snapshot:{capabilities:['throughput-v1']}};
    expect(selectCapacityProbe([{...base,id:'a'},{...base,id:'b'}],'a',now)?.id).toBe('b');
    expect(selectCapacityProbe([{...base,id:'a',selected:false},{...base,id:'b',last_seen:new Date(now-180000)}],null,now)).toBeNull();
    expect(capable({agentVersion:'999.0.0'})).toBe(false);expect(capable({agentVersion:'0.1.3',capabilities:['throughput-v1']})).toBe(true);
    expect(reporting(new Date(now+60000),now)).toBe(false);
  });
  it('never widens the fixed profile byte and duration limits',()=>{
    expect(THROUGHPUT_PROFILES).toEqual({quick:{maxBytes:5242880,timeoutSeconds:10},hourly:{maxBytes:64000000,timeoutSeconds:10},capacity:{maxBytes:10000000000,timeoutSeconds:900}});
    expect(throughputOptions('capacity')).toEqual({profile:'capacity',targetId:'sccc-external-v1',maxBytes:10000000000,timeoutSeconds:900});
  });
  it('drains 52 simultaneous quick checks through the production allocator inside one five-minute period',()=>{
    const slot=Date.parse('2026-10-25T15:05:00Z'),activation=new Date(slot-300000),limits={quickConcurrency:4,hourlyConcurrency:1,capacityConcurrency:1};
    const lanes:TransferLane[]=Array.from({length:8},(_,i)=>({id:i+1,job_id:null,building_id:null,lease_until:null}));
    const probes=Array.from({length:52},(_,i)=>({id:`pc-${i}`,building:`building-${Math.floor(i/2)}`,runningUntil:0,completed:false}));
    let completedAt=0,peak=0;
    // Include the full regular 60-second idle heartbeat phase before queued 12-second polls.
    for(let now=slot+60000;now<=slot+300000;now+=PENDING_POLL_SECONDS*1000) {
      for(const p of probes)if(p.runningUntil&&p.runningUntil<=now&&!p.completed){p.completed=true;for(const l of lanes)if(l.job_id===p.id){l.job_id=null;l.building_id=null;l.lease_until=null;}}
      for(const p of probes) {
        if(p.completed||p.runningUntil)continue;
        const admitted=deviceSlot(p.id,1,activation,now);expect(admitted?.late).toBe(false);
        const id=chooseTransferLane('quick',lanes,p.building,limits,now);if(id===null)continue;
        const lane=lanes.find(l=>l.id===id)!;Object.assign(lane,{job_id:p.id,building_id:p.building,lease_until:new Date(now+30000)});p.runningUntil=now+10000;
      }
      const active=lanes.filter(l=>!!l.job_id);peak=Math.max(peak,active.length);expect(new Set(active.map(l=>l.building_id)).size).toBe(active.length);
      if(probes.every(p=>p.completed)){completedAt=now-slot;break;}
    }
    expect(peak).toBe(4);expect(probes.every(p=>p.completed)).toBe(true);expect(completedAt).toBeLessThanOrEqual(240000);
  });
  it('never lets hourly or capacity transfers consume quick lanes and enforces hard caps',()=>{
    const now=Date.now(),lanes:TransferLane[]=Array.from({length:8},(_,i)=>({id:i+1,job_id:null,building_id:null,lease_until:null}));
    expect(chooseTransferLane('hourly',lanes,'A',{},now)).toBe(5);expect(chooseTransferLane('capacity',lanes,'A',{},now)).toBe(7);
    for(const lane of lanes.filter(l=>l.id<=4))Object.assign(lane,{job_id:`job-${lane.id}`,building_id:`B-${lane.id}`,lease_until:new Date(now+30000)});
    expect(chooseTransferLane('quick',lanes,'A',{quickConcurrency:99},now)).toBeNull();
    expect(chooseTransferLane('hourly',lanes,'A',{},now)).toBe(5);expect(chooseTransferLane('capacity',lanes,'A',{},now)).toBe(7);
  });
});
describe('explicit throughput capability and metadata allowlists',()=>{
  const base={jobId:randomUUID(),kind:'throughput',selectionRevision:1,slotAt:'2026-10-25T15:00:00Z',startedAt:'2026-10-25T15:00:00Z',completedAt:'2026-10-25T15:00:01Z',outcome:'completed',details:{profile:'hourly',targetId:'sccc-external-v1',bytes:1000,elapsedMs:1000,mbps:.008,rangeCount:1,termination:'byte_budget',localAddress:null}};
  it('accepts bounded measurements and rejects URL/command/audio fields',()=>{
    expect(resultSchema.safeParse(base).success).toBe(true);
    expect(resultSchema.safeParse({...base,details:{...base.details,url:'https://arbitrary.test'}}).success).toBe(false);
    expect(resultSchema.safeParse({...base,selectionRevision:undefined}).success).toBe(false);
    expect(resultSchema.safeParse({...base,details:{...base.details,bytes:10000000001}}).success).toBe(false);
  });
  it('allows at most ten bounded range segments and preserves original sample times',()=>{
    const segment={ordinal:0,requestedBytes:1000,bytes:1000,status:206,elapsedMs:1000};
    expect(resultSchema.safeParse({...base,details:{...base.details,segments:[segment]}}).success).toBe(true);
    expect(resultSchema.safeParse({...base,details:{...base.details,segments:Array(11).fill(segment)}}).success).toBe(false);
    expect(resultSchema.parse(base).startedAt).toBe(base.startedAt);
  });
});
