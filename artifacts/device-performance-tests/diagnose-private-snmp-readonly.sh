#!/bin/sh
python3 - <<'PY'
import csv, json, os, signal, sys, time
from pathlib import Path
root=Path('/opt/sccc-building-diagnostics/current')
sys.path.insert(0,str(root))
from private_snmp_collector import load_agent, FDB_PORT, FDB_STATUS, BRIDGE_MAP
def stop(*_): raise TimeoutError('bounded diagnostic deadline')
signal.signal(signal.SIGALRM,stop);signal.alarm(45)
profiles=Path('/etc/sccc-noc-probe-snmp/profiles.json')
metadata=json.loads(profiles.read_text())['targets']
targets=[r for r in csv.DictReader(Path('/etc/sccc-building-diagnostics/targets.csv').open()) if r['ip'] in metadata]
state=Path('/var/lib/sccc-building-diagnostics')
counters=json.loads((state/'counters.json').read_text())
inventory=json.loads((state/'inventory.json').read_text())
mac='ac:b4:80:0b:98:c3'
matches=[{k:r.get(k) for k in ('building','source','switchName','port')} for r in inventory.get('observations',[]) if r.get('mac','').lower()==mac]
buildings={r.get('building') for r in matches}
chosen=[r for r in targets if r['building'] in buildings][:2]
for row in targets:
    if len(chosen)>=2: break
    if row not in chosen and row['ip'] not in counters: chosen.append(row)
for row in targets:
    if len(chosen)>=2: break
    if row not in chosen: chosen.append(row)
print(json.dumps({'source':str(root.resolve()),'approvedTargets':len(targets),'profileMetadataMode':oct(profiles.stat().st_mode&0o777),'completedCounterTargets':len([k for k in counters if not k.startswith('__')]),'nextTargetIndex':counters.get('__nextTargetIndex'),'pilotMacMatches':matches,'selected':[{'name':r['name'],'ip':r['ip'],'building':r['building']} for r in chosen]},separators=(',',':')),flush=True)
agent=load_agent(Path('/opt/sccc-noc-probe/noc_probe_agent.py'))
agent.SNMP_COMMAND_TIMEOUT=5
def category(message):
    value=(message or '').lower()
    for label,words in [('timeout',('timed out','timeout')),('unknown-user',('unknown user',)),('authorization',('authorization','access denied','not in time window')),('authentication',('authentication','incorrect password','wrong digest')),('unsupported',('no such','end of mib')),('start-failed',('unable to start',))]:
        if any(w in value for w in words): return label
    return 'other' if value else None
for target in chosen:
    row={'name':target['name'],'ip':target['ip'],'explicitProfileLoaded':target['ip'] in agent.SNMP_PROFILES,'walks':[]}
    for label,oid in [('ifName','.1.3.6.1.2.1.31.1.1.1.1'),('bridgeMap',BRIDGE_MAP),('qFdbPort',FDB_PORT),('qFdbStatus',FDB_STATUS)]:
        started=time.monotonic();out,error=agent.run_snmpwalk(target['ip'],oid)
        values=agent.parse_walk(out,oid)
        row['walks'].append({'oid':label,'seconds':round(time.monotonic()-started,2),'rows':len(values),'error':category(error or (out if not values else '')),'pilotFdbMatches':sum(1 for key in values if len(key)==7 and ':'.join(f'{x:02x}' for x in key[1:])==mac) if label.startswith('qFdb') else None})
    print(json.dumps(row,separators=(',',':')),flush=True)
signal.alarm(0)
PY
