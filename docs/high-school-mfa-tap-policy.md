# High School MFA TAP Policy

The SCCC High School Student Access service provides eligible students with
one-time Microsoft Entra Temporary Access Passes when school device rules make
phone-based MFA unavailable.

## Current limits

- Student daily limit: 15 successful TAP issuances per UTC day.
- Review threshold: 4 successful TAP issuances per student per UTC day.
- Above-policy activity: more than 15 successful TAP issuances per student per
  UTC day.
- Faculty daily limit: 10 grants per issuing faculty account unless separately
  configured.

The enforcement setting is `STUDENT_DAILY_LIMIT` in the protected
`/etc/sccc-mfa.env` file on app-server2. The application default is also 15 so
a missing environment value does not silently restore the former limit.

The Insight Hub report reads its policy values from the generated MFA TAP usage
dataset and displays review and above-policy thresholds dynamically.

## Operations

After changing the production limit:

1. Back up `/etc/sccc-mfa.env`.
2. update `STUDENT_DAILY_LIMIT`;
3. restart `sccc-mfa.service`;
4. verify `/health` returns HTTP 200;
5. regenerate the MFA TAP usage dataset as the `scccadmin` service account; and
6. verify the Insight Hub report shows the same policy limit.

Do not reset a student's limit by deleting audit events. The audit trail is a
security record and must remain intact.

## Architecture impact

Diagram impact: none. This change adjusts a policy value and report labels; it
does not change components, integrations, data flow, or database structure.
