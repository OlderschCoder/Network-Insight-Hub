"""Per-device collection publication. Authentication and schema failures stay failures."""
import csv, json, os, subprocess, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from publish_switch_telemetry import send_switch, SCHEMA

def now(): return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
def save(path, data):
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(data,indent=2));tmp.chmod(0o600);tmp.replace(path)
def failure(s, stage, error):
    text=str(error)
    for key,value in os.environ.items():
        if value and any(x in key.upper() for x in ('PASS','TOKEN','SECRET')): text=text.replace(value,'[REDACTED]')
    return dict(switch_name=s.get('switch_name','unknown'),switch_ip=s.get('switch_ip',''),building=s.get('building'),stage=stage,error=text[:500],observed_at=s.get('polled_at') or now())
def publish_available(aggregate, targets, endpoint, token, sender=send_switch):
    if aggregate.get('schema')!=SCHEMA or not aggregate.get('run_id'): raise ValueError('Invalid aggregate identity')
    rows=aggregate.get('switches')
    if not isinstance(rows,list): raise ValueError('Invalid aggregate records')
    counts=Counter(s.get('switch_ip') for s in rows if isinstance(s,dict))
    expected={r['ip']:r for r in targets}; failures=[]; preflight=[]; results=[]; eligible=0
    for ip,r in expected.items():
        if not counts[ip]: failures.append(failure({'switch_name':r['name'],'switch_ip':ip,'building':r.get('building')},'collection','No result returned for target'))
    for s in rows:
        if not isinstance(s,dict): failures.append(failure({},'validation','Non-object collector result'));continue
        ip=s.get('switch_ip')
        if ip not in expected or counts[ip]!=1:
            failures.append(failure(s,'validation','Unexpected or duplicate management IP'));continue
        if not s.get('ok'):
            failures.append(failure(s,'collection','; '.join(s.get('errors') or ['Collection unsuccessful'])));continue
        if not s.get('building') or not any(i.get('is_physical') is True for i in s.get('interfaces',[]) if isinstance(i,dict)):
            failures.append(failure(s,'validation','Missing building or physical interface evidence'));continue
        try:
            stamp=datetime.fromisoformat(s['polled_at'].replace('Z','+00:00'))
            age=(datetime.now(timezone.utc)-stamp).total_seconds()
            if not 0 <= age <= 3600: raise ValueError('stale or future observation')
        except (KeyError,TypeError,ValueError):
            failures.append(failure(s,'validation','Invalid, stale or future collection timestamp'));continue
        eligible+=1
        try: p=sender(endpoint,token,aggregate,s,dry_run=True)
        except Exception as e: p={'ok':False,'error':type(e).__name__,'status':None}
        preflight.append(dict(p,switch_ip=ip))
        if not p.get('ok'):
            failures.append(failure(s,'preflight',f"HTTP {p.get('status')}: {p.get('error','rejected')}"));continue
        try: p=sender(endpoint,token,aggregate,s,dry_run=False)
        except Exception as e: p={'ok':False,'error':type(e).__name__,'status':None}
        results.append(dict(p,switch_ip=ip))
        if not p.get('ok'): failures.append(failure(s,'publish',f"HTTP {p.get('status')}: {p.get('error','rejected')}"))
    applied=sum(bool(r.get('ok')) for r in results)
    return dict(schema='sccc.network.switchport_telemetry.publish.v1',run_id=aggregate['run_id'],preflight_attempted=len(preflight),preflight_succeeded=sum(bool(r.get('ok')) for r in preflight),preflight_failed=sum(not r.get('ok') for r in preflight),preflight_results=preflight,attempted=len(results),applied=applied,failed=sum(not r.get('ok') for r in results),results=results,failures=failures,eligible=eligible)

def main():
    import fcntl
    root=Path('/var/lib/sccc-switch-telemetry');app=Path(__file__).resolve().parent
    lock=open('/var/lib/sccc-switch-telemetry-lock/run.lock','a')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: print('Collection already running');return 0
    started=now();run_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid());run=root/'runs'/run_id;run.mkdir(parents=True,mode=0o700)
    status=dict(schema='sccc.network.switchport_telemetry.status.v1',state='running',release=app.name,run_id=run_id,started_at=started,finished_at=None,stage='collection',failures=[])
    save(root/'status.json',status)
    # Latest attempt is separate from last successful publication, so failed runs stay visible.
    link=root/'.latest-attempt.tmp';link.symlink_to(run);link.replace(root/'latest-attempt')
    try:
        targets=list(csv.DictReader((app/'switches.csv').open()))
        required=set((app/'required-targets.txt').read_text().splitlines())
        if len(targets)!=len(required) or {r['ip'] for r in targets}!=required: raise ValueError('Manifest does not match reviewed target set')
        endpoint=os.environ.get('SWITCH_TELEMETRY_IMPORT_URL','').strip();uri=urlsplit(endpoint)
        if endpoint!='http://10.0.0.44:8080/api/network-map/import/telemetry/switch' and not (uri.scheme=='https' and uri.hostname=='app-server2.centralus.cloudapp.azure.com' and uri.path=='/api/network-map/import/telemetry/switch' and not uri.query and not uri.username): raise ValueError('Unexpected import destination')
        token=os.environ.get('SWITCH_TELEMETRY_TOKEN','').strip()
        if not token: raise ValueError('Importer token missing')
        aggregate_path=run/'sccc_all_switches_single.json'
        env=dict(os.environ,FRED_INVENTORY_FILE=str(app/'switches.csv'),OUT_DIR=str(run),OUTPUT_JSON=str(aggregate_path),PYTHONUNBUFFERED='1')
        with (run/'collector.log').open('w') as log:
            completed=subprocess.run([str(app/'.venv/bin/python'),str(app/'collect_switch_ports.py'),'--workers',os.environ.get('COLLECT_WORKERS','4'),'--output-json',str(aggregate_path)],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=2700)
        if completed.returncode or not aggregate_path.exists(): raise RuntimeError('Collector did not produce a complete result file; inspect collector.log')
        aggregate=json.loads(aggregate_path.read_text());status.update(stage='publication',collection_run_id=aggregate.get('run_id'));save(root/'status.json',status)
        result=publish_available(aggregate,targets,endpoint,token);save(run/'telemetry_publish.json',result)
        from audit_switch_telemetry import audit
        try: _,report=audit(aggregate_path)
        except Exception as e: report={'passed':False,'issues':['Audit error: '+type(e).__name__]}
        report.update(failures=result['failures'],imports_applied=result['applied'],publication_complete=not result['failures'],generated_at=aggregate.get('generated_at'))
        from firewall_telemetry import collect_firewalls
        with (app/'device-catalog.csv').open() as handle:
            firewall = collect_firewalls(list(csv.DictReader(handle)))
        save(run/'firewall_telemetry.json',firewall)
        result['failures'].extend(firewall['failures'])
        report.update(firewalls=firewall['firewalls'],firewalls_ok=firewall['ok'],firewalls_failed=firewall['failed'])
        status.update(firewalls=firewall['firewalls'],firewalls_ok=firewall['ok'],firewalls_failed=firewall['failed'],firewall_checked_at=firewall['checked_at'])
        save(run/'telemetry_audit.json',report)
        state='completed_with_warnings' if result['failures'] else 'completed'
        if not result['applied']: state='failed'
        status.update(state=state,stage='finished',finished_at=now(),expected_targets=len(targets),switches_ok=result['eligible'],switches_failed=len(targets)-result['eligible'],imports_applied=result['applied'],imports_failed=result['eligible']-result['applied'],failures=result['failures'],message=f"Published {result['applied']} of {len(targets)} switch targets; {len(result['failures'])} exceptions. Failed targets were not marked up or refreshed.")
        save(root/'status.json',status)
        if result['applied']:
            link=root/'.latest.tmp';link.symlink_to(run);link.replace(root/'latest')
        print(json.dumps(status));return 0 if result['applied'] else 1
    except Exception as e:
        status.update(state='failed',stage='failed',finished_at=now(),message=str(e),failures=[failure({},'pipeline',str(e))]);save(root/'status.json',status);print(json.dumps(status));return 1
if __name__=='__main__':sys.exit(main())
