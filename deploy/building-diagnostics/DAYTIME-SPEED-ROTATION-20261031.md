# Daytime building speed rotation - 2026-10-31

The recurring daily rotation runs at 7, 9, 11, 1, 3, 5, and 7 Central.
Each bounded window selects up to five currently ready computers per canonical
physical building. Selection is fair across buildings and prefers the computers
with the oldest prior test time.

- Only enrolled, non-revoked, online, AD-verified endpoints advertising
  `librespeed-v2` are eligible.
- At most four jobs may be queued or running at once. The controller reconciles
  every minute and stops after 110 minutes, leaving a ten-minute gap before the
  next window.
- The existing measurement records each active routable Ethernet and Wi-Fi
  interface separately and publishes completed results to the existing live
  dashboards.
- Reports are written beneath `/home/scccadmin/daytime-speed/<window>`.
- The overnight sweep remains a separate, date-bounded campaign.

The timing/loss timer used the ambiguous `07..19:00/2:00` expression, which
systemd interpreted as every two minutes. It is corrected to the explicit same
two-hour daily schedule.

Rollback:

```bash
sudo systemctl disable --now sccc-daytime-librespeed.timer
```

Stopping the timer prevents future windows. A running window can be stopped with
`sudo systemctl stop sccc-daytime-librespeed.service`; already claimed endpoint
tests finish normally.
