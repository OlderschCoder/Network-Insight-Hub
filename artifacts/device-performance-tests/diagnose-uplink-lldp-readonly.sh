#!/bin/sh
python3 - <<'PY'
import csv,json,signal,sys,time
from pathlib import Path
sys.path.insert(0,'/opt/sccc-building-diagnostics/current')
from private_snmp_collector import load_agent,BRIDGE_MAP
from build_inventory import normalize_port
def stop(*_): raise TimeoutError('bounded LLDP metadata deadline')
signal.signal(signal.SIGALRM,stop);signal.alarm(90)
agent=load_agent(Path('/opt/sccc-noc-probe/noc_probe_agent.py'))
rows=list(csv.DictReader(Path('/etc/sccc-building-diagnostics/targets.csv').open()))
target=next(row for row in rows if row['name'].lower()=='swa-t122')
assert target['ip'] in agent.SNMP_PROFILES
captures={};original=agent.run_snmpwalk
def capture(address,oid,required=True):
 out,error=original(address,oid,required);captures[oid]=out;return out,error
agent.run_snmpwalk=capture
started=time.monotonic()
try:
 result=agent.collect_lldp_target({'hostname':target['name'],'ip':target['ip']})
 interfaces=[r for r in result.get('interfaces',[]) if normalize_port(r['interfaceName'])=='1/1/49']
 local=agent.parse_walk(captures.get(agent.LLDP_LOCAL_PORT_OID,''),agent.LLDP_LOCAL_PORT_OID)
 bridge=agent.parse_walk(captures.get(BRIDGE_MAP,''),BRIDGE_MAP)
 neighbors=[]
 for n in result.get('neighbors',[]):
  number=n.get('localPortNum');description=local.get((4,number));subtype=local.get((2,number))
  neighbors.append({'localPortNum':number,'localPort':n.get('localPort'),'localDescription':description,'localSubtype':subtype,'remoteSystemName':n.get('remoteSystemName'),'remotePort':n.get('remotePort'),'remoteSystemDescription':str(n.get('remoteSystemDescription',''))[:160]})
 print(json.dumps({'name':target['name'],'ip':target['ip'],'seconds':round(time.monotonic()-started,3),'ok':result.get('ok'),'interfaceCount':len(result.get('interfaces',[])),'interface49':[{k:r.get(k) for k in ('ifIndex','interfaceName','macAddress','description','isPhysical','operStatus','speedMbps','nativeVlan','allowedVlans','portMode','portchannel')} for r in interfaces],'bridgePortsFor49':[key[0] for key,value in bridge.items() if len(key)==1 and any(str(r['ifIndex'])==value for r in interfaces)],'neighborCount':len(neighbors),'neighbors':neighbors[:10]},separators=(',',':')))
except Exception as error:
 print(json.dumps({'name':target['name'],'seconds':round(time.monotonic()-started,3),'failureClass':type(error).__name__}))
signal.alarm(0)
PY
