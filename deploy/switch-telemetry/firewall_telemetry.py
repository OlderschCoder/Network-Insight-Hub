"""Read firewall reachability and fresh SNMP evidence without altering devices."""
import csv
import io
import json
import os
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def summarize(host, rows, reachable, checked_at):
    fresh = []
    for row in rows:
        try:
            observed = datetime.fromisoformat(row['_time'].replace('Z', '+00:00'))
            age = (datetime.fromisoformat(checked_at.replace('Z', '+00:00')) - observed).total_seconds()
        except (KeyError, ValueError, TypeError):
            continue
        if 0 <= age <= 900 and row.get('_measurement') != 'ping':
            fresh.append(row)
    names = {row.get('ifName') or row.get('ifDescr') for row in fresh
             if row.get('ifName') or row.get('ifDescr')}
    return {
        'host': host, 'reachable': reachable, 'telemetryAvailable': bool(fresh),
        'lastPolled': max((r['_time'] for r in fresh), default=None),
        'interfaceTelemetryAvailable': bool(names), 'interfaceCount': len(names),
        'checkedAt': checked_at,
    }


def collect_firewalls(catalog):
    checked = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    output = {'schema': 'sccc.network.firewall_telemetry.status.v1',
              'checked_at': checked, 'firewalls': [], 'failures': []}
    for target in catalog:
        if target.get('device_type', '').lower() != 'firewall' or target.get('monitoring_required', '').lower() != 'true':
            continue
        host = target['ip']
        try:
            reachable = subprocess.run(['ping', '-c', '1', '-W', '2', host],
                                       capture_output=True, timeout=5).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            reachable = False
        rows = []
        error = None
        try:
            bucket = os.environ['INFLUXDB_BUCKET']
            flux = (f'from(bucket: {json.dumps(bucket)}) |> range(start: -15m) '
                    f'|> filter(fn: (r) => (exists r.agent_host and r.agent_host == {json.dumps(host)}) '
                    f'or (exists r.source and r.source == {json.dumps(host)})) '
                    '|> last() |> keep(columns: ["_time", "_measurement", "_field", "_value", "ifName", "ifDescr"])')
            url = os.environ['INFLUXDB_URL'].rstrip('/') + '/api/v2/query?org=' + urllib.parse.quote(os.environ['INFLUXDB_ORG'])
            request = urllib.request.Request(url, data=flux.encode(), headers={
                'Authorization': 'Token ' + os.environ['INFLUXDB_TOKEN'],
                'Content-Type': 'application/vnd.flux', 'Accept': 'application/csv'})
            with urllib.request.urlopen(request, timeout=15) as response:
                text = response.read(2_000_000).decode()
            # Flux can emit several tables with different column sets.
            header = None
            for values in csv.reader(io.StringIO(text)):
                if not values or values[0].startswith('#'):
                    continue
                if '_time' in values and '_field' in values:
                    header = values
                elif header:
                    rows.append(dict(zip(header, values)))
        except Exception as exc:
            error = 'Telemetry lookup failed: ' + type(exc).__name__
        result = summarize(host, rows, reachable, checked)
        result.update(name=target['name'], building=target.get('site') or target.get('building'))
        output['firewalls'].append(result)
        if error or not result['telemetryAvailable'] or not result['interfaceTelemetryAvailable']:
            output['failures'].append({
                'switch_name': target['name'], 'switch_ip': host, 'building': result['building'],
                'stage': 'firewall', 'observed_at': checked,
                'error': error or ('No fresh SNMP telemetry; reachability is reported separately'
                                   if not result['telemetryAvailable'] else 'Fresh system telemetry, but no interface telemetry'),
            })
    output['expected'] = len(output['firewalls'])
    output['ok'] = sum(x['telemetryAvailable'] and x['interfaceTelemetryAvailable'] for x in output['firewalls'])
    output['failed'] = output['expected'] - output['ok']
    return output
