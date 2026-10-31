import {describe,it,expect} from 'vitest';
import {remainingCapacity,capacityDeadline,terminalCapacityBytes,CAPACITY_WINDOW_BYTES} from './building_probe_capacity';
describe('one logical capacity budget',()=>{
  it('charges all unknown reserved bytes rather than inventing a remaining transfer budget',()=>{
    expect(remainingCapacity(0,CAPACITY_WINDOW_BYTES)).toBe(0);
    expect(terminalCapacityBytes({outcome:'unavailable',details:{bytes:3000000000,bytesAccounted:false}},CAPACITY_WINDOW_BYTES)).toBeNull();
    expect(terminalCapacityBytes({outcome:'cancelled',details:{bytes:0}},CAPACITY_WINDOW_BYTES)).toBeNull();
    expect(()=>remainingCapacity(1,CAPACITY_WINDOW_BYTES)).toThrow();
  });
  it('only releases unused bytes after explicit terminal accounting',()=>{
    const actual=terminalCapacityBytes({outcome:'unavailable',details:{bytes:3000000000,bytesAccounted:true}},CAPACITY_WINDOW_BYTES)!;
    expect(actual).toBe(3000000000);expect(remainingCapacity(actual,0)).toBe(7000000000);
    expect(terminalCapacityBytes({outcome:'completed',details:{bytes:CAPACITY_WINDOW_BYTES,termination:'byte_budget'}},CAPACITY_WINDOW_BYTES)).toBe(CAPACITY_WINDOW_BYTES);
    expect(remainingCapacity(CAPACITY_WINDOW_BYTES,0)).toBe(0);
  });
  it('starts one 900-second deadline and clamps it to the wall-clock hard end',()=>{
    expect(capacityDeadline('2026-10-26T00:30:00Z','2026-10-26T00:45:00Z').toISOString()).toBe('2026-10-26T00:45:00.000Z');
    expect(capacityDeadline('2026-10-26T00:50:00Z','2026-10-26T00:45:00Z').toISOString()).toBe('2026-10-26T01:00:00.000Z');
  });
});
