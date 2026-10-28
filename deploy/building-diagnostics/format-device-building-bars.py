#!/usr/bin/env python3
"""Format only the two current building-count panels from a live Grafana model."""
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
    return updated


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('live_model', type=Path)
    parser.add_argument('output_model', type=Path)
    args = parser.parse_args()
    model = json.loads(args.live_model.read_text(encoding='utf-8'))
    args.output_model.write_text(json.dumps(format_building_bars(model), indent=2) + '\n', encoding='utf-8')
