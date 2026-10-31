import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseFluxCsv,summarizeBuildingPerformance,queryWallboardPerformance} from './wallboard_performance';
const now=Date.parse('2026-10-31T06:00:00Z');
const row=(extra:Record<string,string>={})=>({building:'West Campus',computer:'PC1',adapter:'ethernet',_field:'download_mbps',_time:'2026-10-31T05:00:00Z',_value:'100',...extra});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('wallboard performance evidence',()=>{
 it('parses changing Flux table headers, quotes and CRLF',()=>{
  expect(parseFluxCsv('#datatype,string,long,string,double\r\n,result,table,building,_value\r\n,,0,"West, Campus",12\r\n\r\n,result,table,_value,_field\r\n,,1,2,clients_total\r\n')).toEqual([{ '':'',result:'',table:'0',building:'West, Campus',_value:'12'},{'':'',result:'',table:'1',_value:'2',_field:'clients_total'}]);
 });
 it('matches latest-per-computer-and-adapter then mean, without overweighting history',()=>{
  const result=summarizeBuildingPerformance([row({_value:'900',_time:'2026-10-31T04:00:00Z'}),row(),row({adapter:'wifi',_value:'50'}),row({computer:'PC2',_value:'300'}),row({_field:'upload_mbps',_value:'20'})],now)[0];
  expect(result.download?.mbps).toBe(150);expect(result.download?.sampleCount).toBe(3);expect(result.upload?.mbps).toBe(20);
 });
 it('retains evidence ages including stale constituents, without refreshing old values',()=>{
  const r=summarizeBuildingPerformance([row(),row({computer:'PC2',_time:'2026-10-30T12:00:00Z'})],now)[0];
  expect(r.download?.includesSamplesOlderThan12Hours).toBe(true);expect(r.download?.oldestAgeMinutes).toBe(1080);expect(r.download?.newestAgeMinutes).toBe(60);
 });
 it('rejects invalid, future, missing and negative samples but retains measured zero',()=>{
  const r=summarizeBuildingPerformance([row({_value:''}),row({_value:'NaN'}),row({_value:'-1'}),row({_time:'2027-01-01T00:00:00Z'}),row({_value:'0'})],now)[0];expect(r.download?.mbps).toBe(0);expect(r.upload).toBeNull();
 });
 it('reports missing configuration as unavailable',async()=>{
  vi.stubEnv('INFLUXDB_URL','');vi.stubEnv('INFLUXDB_TOKEN','');expect(await queryWallboardPerformance('{}')).toMatchObject({status:'unavailable'});
 });
 it('preserves available panels when another query fails, without inventing zero',async()=>{
  vi.stubEnv('INFLUXDB_URL','http://influx');vi.stubEnv('INFLUXDB_TOKEN','secret');
  vi.stubGlobal('fetch',vi.fn(async(_url,opts)=>String(opts.body).includes('sccc_device_performance')?{ok:false,status:503}:{ok:true,text:async()=>''}));
  const r=await queryWallboardPerformance('{}');expect(r).toMatchObject({status:'partial',buildings:[],backboneLoadBitsPerSecond:null,errors:{buildingSpeeds:'InfluxDB HTTP 503'}});
 });
});
