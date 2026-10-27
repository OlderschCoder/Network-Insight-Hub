import {describe,it,expect} from 'vitest';
import {validatedInstalledAt,ProbeError} from './building_probe_protocol';
import {resolveCadenceAnchor,deviceSlot,type CadenceAnchorState} from './building_probe_scheduler';
const empty:CadenceAnchorState={installedAt:null,anchorAt:null,source:null,resolvedAt:null};
describe('durable installation cadence and selection admission',()=>{
  const now=Date.parse('2026-10-25T12:07:00Z'),installed='2026-10-25T10:03:00.000Z',selected='2026-10-25T12:07:00.000Z';
  it('validates a bounded ISO installation timestamp without accepting future or epoch placeholders',()=>{
    expect(validatedInstalledAt(installed,now)).toBe(installed);
    for(const value of ['not-a-time','1999-12-31T23:59:59Z','2026-10-25T12:08:00Z',null,0])expect(validatedInstalledAt(value,now)).toBeNull();
    expect(validatedInstalledAt('2026-10-25T12:07:30Z',now)).toBe('2026-10-25T12:07:30.000Z');
  });
  it('uses historic install phase while refusing the still-current preselection slot',()=>{
    const anchor=resolveCadenceAnchor(empty,installed,selected,now);expect(anchor.anchorAt).toBe(installed);expect(anchor.source).toBe('installed-at');
    expect(deviceSlot('pc',1,anchor.anchorAt,now,selected)).toBeNull();
    expect(deviceSlot('pc',1,anchor.anchorAt,Date.parse('2026-10-25T12:08:00Z'),selected)).toMatchObject({profile:'quick',slotAt:'2026-10-25T12:08:00.000Z'});
    expect(deviceSlot('pc',1,anchor.anchorAt,Date.parse('2026-10-25T13:03:00Z'),selected)).toMatchObject({profile:'hourly',slotAt:'2026-10-25T13:03:00.000Z'});
  });
  it('keeps a single explicitly labelled fallback across reselection until first durable evidence arrives',()=>{
    const fallback=resolveCadenceAnchor(empty,undefined,selected,now);expect(fallback).toMatchObject({anchorAt:selected,source:'selection-time-fallback'});
    const reselected=resolveCadenceAnchor(fallback,undefined,'2026-10-25T13:01:00Z',now+3600000);expect(reselected).toEqual(fallback);
    const resolved=resolveCadenceAnchor(fallback,installed,selected,now+1000);expect(resolved).toMatchObject({installedAt:installed,anchorAt:installed,source:'installed-at',resolvedAt:'2026-10-25T12:07:01.000Z'});
    expect(deviceSlot('pc',2,resolved.anchorAt,now+1000,resolved.resolvedAt)).toBeNull();
    expect(resolveCadenceAnchor(resolved,undefined,selected,now+5000)).toEqual(resolved);
  });
  it('pins the first install timestamp, accepts equivalent ISO offsets and rejects later changes',()=>{
    const pinned=resolveCadenceAnchor(empty,installed,selected,now);
    expect(resolveCadenceAnchor(pinned,'2026-10-25T05:03:00-05:00',selected,now)).toEqual(pinned);
    expect(()=>resolveCadenceAnchor(pinned,'2026-10-25T10:04:00Z',selected,now)).toThrow(ProbeError);
    expect(()=>resolveCadenceAnchor(pinned,'2030-01-01T00:00:00Z',selected,now)).toThrow(ProbeError);
  });
  it('retains installation phase after a later selection and an offline gap without replay',()=>{
    const later='2026-10-25T12:09:00.000Z';
    expect(deviceSlot('pc',2,installed,Date.parse(later),later)).toBeNull();
    expect(deviceSlot('pc',2,installed,Date.parse('2026-10-25T12:13:00Z'),later)?.slotAt).toBe('2026-10-25T12:13:00.000Z');
    const resumed='2026-10-25T14:07:00Z';expect(deviceSlot('pc',2,installed,Date.parse(resumed),resumed)).toBeNull();
  });
});
