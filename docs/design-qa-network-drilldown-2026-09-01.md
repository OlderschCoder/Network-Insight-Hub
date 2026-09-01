# Network drill-down design QA — 2026-09-01

## Reference

- User-provided Visualizer screenshot showing the Allied Health building label,
  one switch, and five VLAN nodes.
- User-provided switch-detail screenshot showing Details as the former landing
  tab.
- User-provided building Port Map screenshot showing the faceplate pattern that
  must remain available at building scope.

## Production verification

- Allied Health building container: `499.69 × 480.38` rendered pixels.
- Lowest child (VLAN 845) bottom: `1287.94`; container bottom: `1309.65`.
- Rightmost child bottom/right remained within the building container.
- Current Allied Health switch detail opened with **Port Map** selected and
  rendered all three stack members and their physical ports.
- Building detail retained its separate **Port Map** tab.
- Frontend and API production builds passed.

The Browser screenshot capture endpoint timed out twice, so the visual check
used the authenticated production DOM, rendered bounding boxes, active-tab
state, and the supplied reference screenshots. No P0/P1/P2 layout defect was
found in those measurements.

final result: passed with screenshot-capture limitation documented
