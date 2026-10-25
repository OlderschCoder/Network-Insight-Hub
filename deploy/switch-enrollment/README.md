# Fred switch enrollment control

This collector-local control adds one switch at a time without exposing device
credentials to Fred or the browser. Fred sends a base64url JSON request over a
dedicated forced-command SSH key. The collector validates the private IPv4
address, discovers the switch over SSH, and returns a sanitized preview.

Apply requires the exact text `ENROLL <ip>`. The collector then:

1. captures an encrypted configuration backup;
2. creates or verifies the SNMPv3 monitoring user and `10.0.0.22` collector;
3. saves and reads back the switch configuration;
4. prepares and validates a Telegraf candidate under `/home/ITADMIN/sccc-ops`;
5. atomically promotes the candidate and restarts only the Telegraf Compose service;
6. verifies a fresh interface metric in InfluxDB; and
7. updates the collector inventory CSVs.

The protected collector environment accepts the existing switch-login keys plus
the Aruba SNMP aliases `SMNP_User`, `AUTH_PW`, and `PRIV_PW`. Secret values never
appear in request or result JSON.

Run focused tests with:

```bash
python -m unittest -v test_switch_enrollment_control.py
bash -n ssh_entrypoint.sh
```
