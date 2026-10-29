#!/usr/bin/env python3
"""Apply reviewed building and endpoint bar formatting to a live Grafana model."""
import argparse
import copy
import json
from pathlib import Path


def format_building_bars(model):
    if model.get('uid') != 'sccc-device-performance':
        raise ValueError('Expected the SCCC Device Performance dashboard')
    updated = copy.deepcopy(model)
    expected = {
        19: ('Current online computers by building', 'green'),
        20: ('Current enrolled computers by building', 'blue'),
    }
    matched = set()
    for panel in updated['panels']:
        if panel.get('id') not in expected:
            continue
        title, color = expected[panel['id']]
        if panel.get('title') != title:
            raise ValueError('Building-count panel identity changed')
        panel['type'] = 'bargauge'
        defaults = panel.setdefault('fieldConfig', {}).setdefault('defaults', {})
        defaults.update({
            'displayName': '${__field.labels.building}',
            'unit': 'short', 'decimals': 0, 'min': 0,
            'color': {'mode': 'fixed', 'fixedColor': color},
        })
        panel['options'] = {
            'orientation': 'horizontal',
            'displayMode': 'basic',
            'namePlacement': 'top',
            'valueMode': 'text',
            'showUnfilled': False,
            'sizing': 'manual', 'minVizHeight': 32, 'maxVizHeight': 300,
            'minVizWidth': 0,
            'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False},
            'legend': {'showLegend': False, 'displayMode': 'list', 'placement': 'bottom', 'calcs': []},
        }
        matched.add(panel['id'])
    if matched != set(expected):
        raise ValueError('Both expected building-count panels are required')

    speed_panels = {
        5: ('Endpoint download by building / computer (Mbps)', 'download_mbps', 'blue'),
        6: ('Endpoint upload by building / computer (Mbps)', 'upload_mbps', 'purple'),
    }
    matched_speed = set()
    bucket = None
    for panel in updated['panels']:
        if panel.get('id') not in speed_panels:
            continue
        title, field, color = speed_panels[panel['id']]
        if panel.get('title') != title:
            raise ValueError('Endpoint speed panel identity changed')
        targets = panel.get('targets') or []
        if len(targets) != 1 or 'from(bucket:' not in targets[0].get('query', ''):
            raise ValueError('Endpoint speed panel query is not reviewable')
        query = targets[0]['query']
        bucket = query.split('from(bucket:', 1)[1].split(')', 1)[0].strip()
        targets[0]['query'] = (
            f'from(bucket: {bucket}) |> range(start: v.timeRangeStart, stop: v.timeRangeStop) '
            f'|> filter(fn: (r) => r._measurement == "sccc_device_performance" and r._field == "{field}") '
            '|> filter(fn: (r) => r.type == "librespeed-v2" and r.method == "MultiStreamV2") '
            '|> group(columns: ["building", "computer", "adapter"]) |> last()'
        )
        panel['type'] = 'bargauge'
        panel['description'] = ('Latest validated MultiStreamV2 result per computer and active interface '
                                'in the selected time range. This is endpoint-to-Internet speed, not switch utilization.')
        defaults = panel.setdefault('fieldConfig', {}).setdefault('defaults', {})
        defaults.update({
            'displayName': '${__field.labels.computer} · ${__field.labels.building} · ${__field.labels.adapter}',
            'unit': 'Mbits', 'decimals': 1, 'min': 0,
            'color': {'mode': 'fixed', 'fixedColor': color},
        })
        panel['options'] = bar_options()
        matched_speed.add(panel['id'])
    if matched_speed != set(speed_panels):
        raise ValueError('Both expected endpoint speed panels are required')

    existing_ids = {panel.get('id') for panel in updated['panels']}
    if existing_ids.intersection({22, 23}):
        raise ValueError('Building average panel IDs are already in use')
    datasource = copy.deepcopy(next(panel['datasource'] for panel in updated['panels'] if panel.get('datasource')))
    averages = (
        (22, 'Average download speed by building', 'download_mbps', 'blue', 0),
        (23, 'Average upload speed by building', 'upload_mbps', 'purple', 12),
    )
    for panel_id, title, field, color, x in averages:
        query = (
            f'from(bucket: {bucket}) |> range(start: v.timeRangeStart, stop: v.timeRangeStop) '
            f'|> filter(fn: (r) => r._measurement == "sccc_device_performance" and r._field == "{field}") '
            '|> filter(fn: (r) => r.type == "librespeed-v2" and r.method == "MultiStreamV2") '
            '|> group(columns: ["building", "computer", "adapter"]) |> last() '
            '|> group(columns: ["building"]) |> mean()'
        )
        updated['panels'].append({
            'id': panel_id, 'title': title, 'type': 'bargauge',
            'description': ('Mean of each computer/interface latest validated speed result in the selected time range. '
                            'Unmeasured computers are not treated as zero.'),
            'datasource': copy.deepcopy(datasource),
            'gridPos': {'x': x, 'y': 78, 'w': 12, 'h': 8},
            'fieldConfig': {'defaults': {
                'displayName': '${__field.labels.building}', 'unit': 'Mbits', 'decimals': 1, 'min': 0,
                'color': {'mode': 'fixed', 'fixedColor': color},
            }, 'overrides': []},
            'targets': [{'refId': 'A', 'query': query}],
            'options': bar_options(),
        })
    updated['version'] = int(updated.get('version') or 0) + 1
    return updated


def bar_options():
    return {
        'orientation': 'horizontal', 'displayMode': 'basic', 'namePlacement': 'left',
        'valueMode': 'text', 'showUnfilled': False,
        'sizing': 'manual', 'minVizHeight': 32, 'maxVizHeight': 300, 'minVizWidth': 0,
        'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False},
        'legend': {'showLegend': False, 'displayMode': 'list', 'placement': 'bottom', 'calcs': []},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('live_model', type=Path)
    parser.add_argument('output_model', type=Path)
    args = parser.parse_args()
    model = json.loads(args.live_model.read_text(encoding='utf-8'))
    args.output_model.write_text(json.dumps(format_building_bars(model), indent=2) + '\n', encoding='utf-8')
