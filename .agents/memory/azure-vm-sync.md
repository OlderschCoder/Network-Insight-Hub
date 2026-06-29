---
name: Azure VM sync quirks
description: Non-obvious Azure ARM + RBAC gotchas hit when syncing the VM inventory.
---

Two things broke the "Sync from Azure" feature in ways the code looked correct:

1. **`$expand=instanceView` is NOT valid on the subscription-wide VM list.**
   ARM returns 400 BadRequest ("Expand Instance View is only supported when
   Virtual Machine Scale Set resource filter is applied"). Power state for a
   subscription-wide list must come from the SAME list endpoint with
   `?statusOnly=true`, then merged by VM id. `$expand=instanceView` only works
   on a per-VM GET or on scale sets.
   **How to apply:** never add `$expand=instanceView` to the
   `/providers/Microsoft.Compute/virtualMachines` subscription list call.

2. **The service principal needs an Azure RBAC role; auth succeeding is not
   enough.** Client-credentials token + subscription resolution can all succeed
   while every ARM read still 403s (AuthorizationFailed) until the SP is granted
   **Reader** at subscription scope in the Azure portal. This is an external,
   one-time admin action — no code or secret change fixes it.

**Why:** both produced confusing failures that looked like app bugs (403 then
400) but the 403 was external RBAC and the 400 was an ARM API constraint.
