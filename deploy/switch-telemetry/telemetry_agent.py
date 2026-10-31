"""Fixed telemetry endpoints; no arbitrary commands or paths."""
import hmac,json,os,subprocess
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
ROOT=Path(os.environ.get('SWITCH_TELEMETRY_STATE_ROOT','/var/lib/sccc-switch-telemetry'))
TOKEN=os.environ.get('SWITCH_TELEMETRY_TOKEN','').strip()
HOST=os.environ.get('SWITCH_TELEMETRY_LISTEN_IP','10.0.0.22')
ALLOWED={os.environ.get('SWITCH_TELEMETRY_ALLOWED_CLIENT','10.0.0.44'),'127.0.0.1',HOST}
def read_json(path,default):
    try: return json.loads(path.read_text())
    except (OSError,ValueError): return default
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,code,body):
        data=json.dumps(body).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def authorized(self):
        return bool(TOKEN) and self.client_address[0] in ALLOWED and hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+TOKEN)
    def do_GET(self):
        if not self.authorized(): return self.send(401,{'error':'Unauthorized'})
        if self.path=='/v1/switch-telemetry/status':
            d=read_json(ROOT/'status.json',{'state':'never_run'});d['vantage']='10.0.0.22'
            d['serviceState']=subprocess.run(['/usr/bin/systemctl','is-active','sccc-switch-telemetry.service'],capture_output=True,text=True,timeout=5).stdout.strip()
            for snake,camel in [('run_id','runId'),('started_at','startedAt'),('finished_at','finishedAt'),('switches_ok','switchesOk'),('switches_failed','switchesFailed'),('imports_applied','importsApplied'),('imports_failed','importsFailed')]:d[camel]=d.get(snake)
            d['latestAuditAvailable']=(ROOT/'latest-attempt'/'telemetry_audit.json').exists();return self.send(200,d)
        if self.path=='/v1/switch-telemetry/audit':
            path=ROOT/'latest-attempt'/'telemetry_audit.json'
            return self.send(200,read_json(path,{'state':'audit_not_available','message':'No audit for the latest attempt; see current status.','status':read_json(ROOT/'status.json',{})}))
        return self.send(404,{'error':'Not found'})
    def do_POST(self):
        if not self.authorized():return self.send(401,{'error':'Unauthorized'})
        if self.path!='/v1/switch-telemetry/run':return self.send(404,{'error':'Not found'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=1024: return self.send(400,{'error':'Invalid body'})
            body=json.loads(self.rfile.read(length))
        except (ValueError,TypeError):return self.send(400,{'error':'Invalid body'})
        if body!={'operation':'collect','confirm':True}:return self.send(400,{'error':'Explicit collection confirmation required'})
        r=subprocess.run(['/usr/bin/sudo','-n','/usr/bin/systemctl','--no-block','start','sccc-switch-telemetry.service'],capture_output=True,timeout=10)
        return self.send(202 if r.returncode==0 else 503,{'accepted':r.returncode==0,'message':'Collection requested' if r.returncode==0 else 'Collector could not start'})
if __name__=='__main__':
    if not TOKEN:raise SystemExit('Token is required')
    server=ThreadingHTTPServer((HOST,int(os.environ.get('SWITCH_TELEMETRY_PORT','9124'))),Handler);server.serve_forever()
