#!/bin/sh
python3 - <<'PY'
import json,os,shutil,signal,sys,time
from pathlib import Path
sys.path.insert(0,'/opt/sccc-building-diagnostics/current')
from private_snmp_collector import bounded_process,load_agent
agent=load_agent(Path('/opt/sccc-noc-probe/noc_probe_agent.py'))
target='192.168.2.190';assert target in agent.SNMP_PROFILES
env=os.environ.copy();env['SNMPCONFPATH']=agent.SNMP_PROFILES[target];env['SNMP_PERSISTENT_DIR']='/tmp/sccc-noc-probe-snmp'
tool=shutil.which('snmpbulkwalk');assert tool
results={};tables={}
for label,oid in [('remote',agent.LLDP_REMOTE_OID),('local',agent.LLDP_LOCAL_PORT_OID)]:
 started=time.monotonic()
 output,error=bounded_process([tool,'-v3','-On','-Cr25','-t','1','-r','0',target,oid],env,timeout=15)
 tables[label]=agent.parse_walk(output,oid)
 results[label]={'seconds':round(time.monotonic()-started,3),'rows':len(tables[label]),'bytes':len(output.encode()),'failure':error}
local=tables['local'];grouped={}
for key,value in tables['remote'].items():
 if len(key)==4:
  field,mark,port,index=key;grouped.setdefault((mark,port,index),{})[field]=value
neighbors=[]
for (_mark,port,_index),fields in grouped.items():
 identity=local.get((3,port),'');description=local.get((4,port),'')
 candidate=port==49 or description.lower()=='1/1/49' or identity.lower() in ('0c:97:5f:af:d8:50','c:97:5f:af:d8:50')
 if candidate:
  neighbors.append({'localPortNum':port,'localPortId':identity,'localDescription':description,'localSubtype':local.get((2,port)),'remoteSystemName':fields.get(9),'remoteSystemDescription':str(fields.get(10,''))[:200],'remotePortId':fields.get(7),'remotePortDescription':fields.get(8),'supportedCapabilities':fields.get(11),'enabledCapabilities':fields.get(12)})
print(json.dumps({'source':str(Path('/opt/sccc-building-diagnostics/current').resolve()),'name':'swa-t122','ip':target,'bulkTables':results,'neighborCount':len(grouped),'port49Candidates':neighbors},separators=(',',':')))
PY
