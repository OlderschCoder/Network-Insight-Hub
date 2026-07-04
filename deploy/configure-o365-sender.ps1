<#
    configure-o365-sender.ps1
    ---------------------------------------------------------------------------
    Option A: let the Hub send report emails "as" itech@sccc.edu WITHOUT giving
    itech a password. We use a dedicated LICENSED sender mailbox that has its own
    password + SMTP AUTH, and grant it "Send As" on itech.

    Run from a Windows machine with the ExchangeOnlineManagement module, signed
    in as a Global Admin / Exchange Admin.

    Adjust $Sender if you prefer a different sender address (e.g. noreply@sccc.edu).
#>

$Sender  = "it-reporting@sccc.edu"   # NEW dedicated sender mailbox
$SendAs  = "itech@sccc.edu"          # the service account we want to appear FROM

# --- 0. Connect --------------------------------------------------------------
# One-time: Install-Module ExchangeOnlineManagement -Scope CurrentUser
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -ShowBanner:$false

# --- 1. Create the sender mailbox --------------------------------------------
# EASIEST path: create the user + assign an Exchange Online license in the
# Microsoft 365 admin center (Users > Add a user). It MUST be licensed to have a
# mailbox and to authenticate SMTP. Set a strong password and clear
# "require password change at next sign-in".
#
# (If you want to script creation instead, use Microsoft Graph / MSOnline — mailbox
# provisioning + licensing is out of scope for this Exchange-only script.)

# --- 2. Enable SMTP AUTH on the sender (per-mailbox override) -----------------
Set-CASMailbox -Identity $Sender -SmtpClientAuthenticationDisabled $false

# --- 3. Grant "Send As" on itech to the sender -------------------------------
Add-RecipientPermission -Identity $SendAs -Trustee $Sender -AccessRights SendAs -Confirm:$false

# --- 4. Verify ---------------------------------------------------------------
Write-Host "`n== Sender SMTP AUTH (want: SmtpClientAuthenticationDisabled = False) =="
Get-CASMailbox $Sender | Format-List Name, SmtpClientAuthenticationDisabled

Write-Host "`n== Send As on $SendAs (want: a row with Trustee = $Sender) =="
Get-RecipientPermission $SendAs | Where-Object { $_.Trustee -like "*$($Sender.Split('@')[0])*" } |
    Format-Table Trustee, AccessRights -AutoSize

Write-Host "`n== Tenant-wide SMTP AUTH default (per-mailbox setting above overrides this) =="
Get-TransportConfig | Format-List SmtpClientAuthenticationDisabled

Write-Host @"

NEXT / GOTCHAS
--------------
1. MFA / Security Defaults / Conditional Access will BLOCK basic-auth SMTP.
   The $Sender account must be EXCLUDED from MFA enforcement:
     - If 'Security Defaults' are ON  -> SMTP AUTH is blocked tenant-wide; either
       turn Security Defaults off and use Conditional Access, or move to Graph
       (Option B).
     - If using Conditional Access    -> add $Sender to an exclusion group for the
       policy that requires MFA / blocks legacy auth.
2. Put the $Sender password into /opt/sccc-it/.env.production as SMTP_PASS,
   keep SMTP_FROM=itech@sccc.edu, then: sudo systemctl restart sccc-api
3. Changes can take a few minutes to propagate before the first send succeeds.
"@

# Disconnect-ExchangeOnline -Confirm:$false
