#!/bin/sh
python3 - <<'PY'
import hashlib,json,os,re,stat,subprocess
from pathlib import Path
def properties(unit):
 raw=subprocess.run(['systemctl','show',unit,'-p','ActiveState','-p','SubState','-p','UnitFileState','-p','FragmentPath','-p','DropInPaths','-p','ExecStart'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True).stdout
 data=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
 result={'id':unit,'active':data.get('ActiveState'),'sub':data.get('SubState'),'enabled':data.get('UnitFileState')}
 source=re.findall(r'/[A-Za-z0-9_./-]+\.(?:py|sh)\b',data.get('ExecStart',''))
 if source: result['sources']=source
 image=re.search(r'sccc-wireless-metrics:[A-Za-z0-9._-]+',data.get('ExecStart',''))
 if image: result['image']=image.group()
 if data.get('DropInPaths'): result['dropins']=data['DropInPaths']
 return result
def metadata(path):
 p=Path(path)
 try:
  s=p.lstat();r={'name':p.name,'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid,'gid':s.st_gid}
  if p.is_symlink():r['target']=str(p.resolve())
  return r
 except FileNotFoundError:return {'name':p.name,'missing':True}
def read(path):
 try:return json.loads(Path(path).read_text())
 except (OSError,ValueError):return {}
unit_names=subprocess.run(['systemctl','list-unit-files','--no-legend','--no-pager'],stdout=subprocess.PIPE,text=True).stdout
names=[line.split()[0] for line in unit_names.splitlines() if re.search(r'(sccc-building-diagnostics|sccc-wireless-metrics|noc.*probe|switch.*telemetry)',line,re.I)]
units=[properties(name) for name in names if name.endswith(('.service','.timer'))]
private=Path('/var/lib/sccc-building-diagnostics')
snapshot=read(private/'collector-snapshot.json');inventory=read(private/'inventory.json');presence=read(private/'presence.json');results=read(private/'results.json');ack=read(private/'influx-checkpoint.json')
wireless=read('/var/lib/sccc-wireless-metrics/diagnostics-observations.json')
pilot=next((r for r in presence.get('devices',[]) if r.get('computerName','').upper()=='LP-F6K6S64'),{})
result={'units':units,'privateCurrent':metadata('/opt/sccc-building-diagnostics/current'),'releases':sorted(p.name for p in Path('/opt/sccc-building-diagnostics/releases').iterdir() if p.is_dir()),'protected':{'/etc/sccc-building-diagnostics':[metadata('/etc/sccc-building-diagnostics'),metadata('/etc/sccc-building-diagnostics/worker.env'),metadata('/etc/sccc-building-diagnostics/targets.csv')],'/var/lib/sccc-building-diagnostics':[metadata(private)]+[metadata(private/name) for name in ('inventory.json','presence.json','counters.json','collector-snapshot.json','results.json','results.jsonl','influx-checkpoint.json','grafana-device-performance.json','coordinator.lock')],'/etc/sccc-wireless-metrics.env':metadata('/etc/sccc-wireless-metrics.env'),'/etc/sccc-noc-probe-snmp/profiles.json':metadata('/etc/sccc-noc-probe-snmp/profiles.json')},'privateStats':{'collector':snapshot.get('collectorStatus'),'targetsExpected':snapshot.get('targetsExpected'),'portMetricRows':len(snapshot.get('ports',[])),'adRows':len(inventory.get('adComputers',[])),'presenceRows':len(presence.get('devices',[])),'presenceObservedAt':presence.get('observedAt'),'reportRows':len(results.get('reports',[])),'reportCursor':results.get('cursor'),'influxAckCursor':ack.get('cursor'),'pilot':{k:pilot.get(k) for k in ('computerName','deviceId','online','adVerified','location')}},'wirelessSidecar':{'file':metadata('/var/lib/sccc-wireless-metrics/diagnostics-observations.json'),'observedAt':wireless.get('generatedAt',wireless.get('observedAt')),'rows':len(wireless.get('observations',[])),'clientMacRows':sum('mac' in r for r in wireless.get('observations',[]))}}
raw=json.dumps(result,separators=(',',':'))
if len(raw)>3900:
 result['protected']['/var/lib/sccc-building-diagnostics']=[metadata(private)]+[metadata(private/name) for name in ('inventory.json','presence.json','results.json','influx-checkpoint.json')]
print(json.dumps(result,separators=(',',':')))
PY
