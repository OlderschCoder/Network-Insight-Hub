# Fred assisted Entra recovery

## Outcome and boundary

Fred can prepare a password-recovery handoff for one active regular-student
Entra account. The operator must be signed into Insights as CIO or help desk,
must cite one exact Zendesk ticket, must independently verify the student, and
must confirm the exact action Fred presents.

The workflow does not give Insights a general Microsoft Graph directory-write
credential. Insights signs a narrow request to the existing OnlineKiosk host,
which already owns the student-reset integration. OnlineKiosk rechecks that the
legal name, full nine-digit 800 number, and SCCC username identify the same
active eligible student. It then issues a random, single-use grant that expires
after ten minutes. The student opens the link and enters a private new password
directly into OnlineKiosk.

A completed Entra password reset clears cloud Smart Lockout. It does not
reactivate an account disabled by an administrator or student eligibility
source. Fred must escalate disabled, withdrawn, unmatched, or otherwise
ineligible accounts for source-of-truth review.

## Verification policy

Allowed independent verification methods are:

- in-person inspection of photo ID;
- callback to a phone number already held in an authoritative SCCC system; or
- live video with photo ID.

The name, username, email, 800 number, and any other values supplied in the
ticket are identity-matching data, not independent verification. Fred must not
accept, generate, display, store, or place a password, MFA code, or Temporary
Access Pass in Zendesk, Fred Memory, logs, or chat.

## Runtime controls

The Insights API exposes `prepare_entra_password_reset` only when the signed-in
role is `cio` or `helpdesk` and the HMAC key file exists. Before using the tool,
Fred presents the exact student identifiers, ticket, verification method, and
ten-minute-link action and waits for explicit confirmation.

The broker additionally enforces:

- requests only from the configured Insights private IP;
- HMAC-SHA256 over the timestamp, nonce, and exact body;
- five-minute timestamp skew and nonce replay rejection;
- exact active-student matching in Microsoft Graph;
- verified official notification address;
- an active reset reservation so concurrent resets cannot overlap;
- auditable success, denial, and failure records without secrets.

The assisted link may bypass the kiosk's 30-day self-service usage window, but
not active eligibility, identity matching, rate limits, link expiry, or an
already-active reset reservation.

## Configuration

On the Insights host:

```text
IDENTITY_RECOVERY_BROKER_URL=http://10.0.0.45/internal/admin-recovery-link
IDENTITY_RECOVERY_HMAC_KEY_PATH=/etc/sccc-identity-recovery.key
IDENTITY_RECOVERY_PUBLIC_HOST=app-server2.centralus.cloudapp.azure.com
IDENTITY_RECOVERY_ALLOWED_ROLES=cio,helpdesk
```

On the OnlineKiosk host:

```text
ADMIN_RECOVERY_ALLOWED_IP=10.0.0.44
ADMIN_RECOVERY_HMAC_KEY_PATH=/etc/sccc-identity-recovery.key
ONLINE_KIOSK_PUBLIC_BASE_URL=https://app-server2.centralus.cloudapp.azure.com
```

Generate one high-entropy key, install the same value on both hosts in the
listed path, and restrict it to root plus the relevant service group. Never put
the value in Git, an environment template, shell output, or Fred Memory. Restart
both services after configuration changes.

## Deployment and rollback

1. Build and test the TypeScript API and .NET OnlineKiosk projects.
2. Publish `services/Sccc.OnlineKiosk` for Linux x64 into a versioned release
   directory on the kiosk host.
3. Preserve the existing `/opt/sccc-online-kiosk/current` symlink target, point
   the symlink atomically to the new release, and restart `sccc-online-kiosk`.
4. Deploy the normal Insights API/frontend release and restart `sccc-api`.
5. Verify both health endpoints, then send a correctly signed request with a
   deliberately nonexistent test identity. The broker must authenticate the
   request, return no match, and make no account change.
6. Verify Fred describes the confirmation boundary and that only CIO/help-desk
   users receive the recovery tool.

To roll back, restore the prior OnlineKiosk symlink target, restart
`sccc-online-kiosk`, deploy the prior Insights commit, and restart `sccc-api`.
Removing the HMAC key from the Insights host hides the Fred tool immediately
after the API restarts; it does not affect normal self-service OnlineKiosk use.

See [fred-entra-recovery-flow.mmd](fred-entra-recovery-flow.mmd) for the editable
sequence diagram.
