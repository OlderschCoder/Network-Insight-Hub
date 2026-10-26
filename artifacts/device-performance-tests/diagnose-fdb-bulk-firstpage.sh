#!/bin/sh
python3 - <<'PY'
import json,os,shutil,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,'/opt/sccc-building-diagnostics/current')
from private_snmp_collector import load_agent,FDB_PORT,FDB_STATUS
agent=load_agent(Path('/opt/sccc-noc-probe/noc_probe_agent.py'))
target='192.168.2.27'
assert target in agent.SNMP_PROFILES
tool=shutil.which('snmpbulkget')
assert tool
env=os.environ.copy();env['SNMPCONFPATH']=agent.snmp_profile_dir(target);env['SNMP_PERSISTENT_DIR']='/tmp/sccc-noc-probe-snmp'
started=time.monotonic()
try:
 r=subprocess.run([tool,'-v3','-On','-Cn0','-Cr10','-t','1','-r','0',target,FDB_PORT,FDB_STATUS],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
 print(json.dumps({'name':'SW-BB','seconds':round(time.monotonic()-started,3),'returncode':r.returncode,'portRows':len(agent.parse_walk(r.stdout,FDB_PORT)),'statusRows':len(agent.parse_walk(r.stdout,FDB_STATUS)),'bytes':len(r.stdout.encode()),'noSuch':('No Such' in r.stdout),'endOfMib':('End of MIB' in r.stdout),'stderrPresent':bool(r.stderr.strip())},separators=(',',':')))
except subprocess.TimeoutExpired:
 print(json.dumps({'name':'SW-BB','seconds':round(time.monotonic()-started,3),'timeout':True}))
PY
