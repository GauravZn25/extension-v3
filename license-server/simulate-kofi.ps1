# Developer    : Gaurav Jain
# Created Date : 23-Sep-2026
# Purpose      : Exercise the real Ko-fi webhook path without spending money.
#
# Sends the exact payload shape Ko-fi sends - form-encoded, one `data` field
# holding JSON - so this tests the whole chain for real: token check, type
# check, currency check, amount-to-tier mapping, minting, the email index and
# the /stats counter. The ONLY thing it does not prove is that Ko-fi itself can
# reach your Worker; the "Send test" button in Ko-fi's dashboard covers that.
#
# It writes a genuine licence and moves the PUBLIC donation counter, so clean up
# afterwards - the script prints the two commands to do it.
#
# Usage:
#   .\simulate-kofi.ps1 -Token "<KOFI_VERIFICATION_TOKEN>" -Email "you@example.com" -Amount 1
#   .\simulate-kofi.ps1 -Token "..." -Email "you@example.com" -Amount 10 -Type "Shop Order"
#   .\simulate-kofi.ps1 -Token "..." -Email "you@example.com" -Amount 5 -Currency GBP   # expect a skip

param(
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$Email,
    [double]$Amount = 1,
    [string]$Currency = 'USD',
    [ValidateSet('Donation', 'Subscription', 'Shop Order', 'Commission')][string]$Type = 'Donation',
    [string]$WorkerDomain = 'redditdl-license.reddit-downloader.workers.dev'
)

$ErrorActionPreference = 'Stop'
$base = "https://" + ($WorkerDomain -replace '^https?://', '' -replace '/$', '')

# A fresh id every run. Ko-fi's own fixed test id is deliberately ignored by the
# Worker, so reusing it here would mint nothing and prove nothing.
$txn = [guid]::NewGuid().ToString()

$payload = @{
    verification_token     = $Token
    message_id             = [guid]::NewGuid().ToString()
    timestamp              = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    type                   = $Type
    is_public              = $true
    from_name              = 'Test Buyer'
    message                = 'simulated payment'
    amount                 = $Amount.ToString('0.00')
    url                    = 'https://ko-fi.com/gauravzn'
    email                  = $Email
    currency               = $Currency
    is_subscription_payment = $false
    is_first_subscription_payment = $false
    kofi_transaction_id    = $txn
} | ConvertTo-Json -Compress

Write-Host "POST $base/webhook/kofi" -ForegroundColor Cyan
Write-Host ("  {0} {1} {2}  ->  {3}" -f $Type, $Currency, $Amount, $Email) -ForegroundColor DarkGray
Write-Host ("  txn {0}" -f $txn) -ForegroundColor DarkGray
Write-Host ""

$before = Invoke-RestMethod -Uri "$base/stats"

# Ko-fi posts application/x-www-form-urlencoded with a single `data` field.
$body = "data=" + [System.Uri]::EscapeDataString($payload)
$res = Invoke-RestMethod -Method Post -Uri "$base/webhook/kofi" -Body $body -ContentType 'application/x-www-form-urlencoded'

Write-Host "Worker replied:" -ForegroundColor Cyan
$res | ConvertTo-Json -Compress | Write-Host
Write-Host ""

Start-Sleep -Seconds 2
$after = Invoke-RestMethod -Uri "$base/stats"
Write-Host ("stats: `${0} / {1} payment(s)  ->  `$
{2} / {3} payment(s)" -f $before.totalUSD, $before.paymentCount, $after.totalUSD, $after.paymentCount) -ForegroundColor Cyan

Write-Host ""
Write-Host "Now check the licence landed:" -ForegroundColor Yellow
Write-Host ("  Invoke-RestMethod -Method Post -Uri `"$base/retrieve`" -ContentType 'application/json' -Body '{`"email`":`"$Email`"}'")
Write-Host ""
Write-Host "CLEAN UP when you are done testing:" -ForegroundColor Yellow
Write-Host ("  # remove the test licence")
Write-Host ("  Invoke-RestMethod -Method Post -Uri `"$base/admin/delete`" -Headers @{'X-Admin-Secret'='<secret>'} -ContentType 'application/json' -Body '{`"email`":`"$Email`"}'")
Write-Host ("  # put the public counter back to zero")
Write-Host ("  Invoke-RestMethod -Method Post -Uri `"$base/admin/stats`" -Headers @{'X-Admin-Secret'='<secret>'} -ContentType 'application/json' -Body '{`"totalUSD`":0,`"paymentCount`":0}'")
