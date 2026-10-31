# Overnight LibreSpeed sweep - 2026-10-30

This is a one-time, date-bounded campaign. It does not change the normal daytime scheduler.

- Campaign: `overnight-librespeed-2026-10-30`
- Cutoff: 5:00 AM America/Chicago on 2026-10-31
- Scope: every endpoint that is enabled in the current AD roster, enrolled, non-revoked, online within three minutes, AD verified, and advertising `librespeed-v2`
- Dispatch: one-minute reconciliation loop, at most 12 campaign jobs queued/running, and no duplicate endpoint in the campaign
- Measurement: the existing LibreSpeed V2 test, which records each active routable Ethernet and Wi-Fi interface separately
- Reports: hourly JSON and per-computer CSV plus a human-readable latest summary in `/home/scccadmin/overnight-speed-20261030`
- Stop behavior: no new work after the cutoff; any still-queued campaign work is cancelled and the service exits after its final report

Verification:

```bash
systemctl status sccc-overnight-librespeed-20261030.service --no-pager
journalctl -u sccc-overnight-librespeed-20261030.service -n 50 --no-pager
cat /home/scccadmin/overnight-speed-20261030/latest-summary.txt
```

Rollback before the cutoff:

```bash
sudo systemctl stop sccc-overnight-librespeed-20261030.service
```

Stopping the service prevents further dispatch. Already claimed tests finish normally; queued campaign jobs can be cancelled separately if an immediate abort is required.
