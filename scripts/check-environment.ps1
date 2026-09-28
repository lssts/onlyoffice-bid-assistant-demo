param([string]$OnlyOfficeUrl = "http://10.174.202.82:9898", [switch]$OwnerContainer)
$ErrorActionPreference = 'Continue'
Write-Host '1. Shared ONLYOFFICE health (expected true)'
try { (Invoke-WebRequest "$OnlyOfficeUrl/healthcheck" -TimeoutSec 8).Content } catch { Write-Host $_.Exception.Message }
Write-Host '2. Local Python health'
try { Invoke-RestMethod 'http://127.0.0.1:8010/api/health' -TimeoutSec 10 | Format-List } catch { Write-Host $_.Exception.Message }
if ($OwnerContainer) {
    Write-Host '3. Owner-only container checks'
    docker ps -a --filter name=onlyoffice-prod --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    docker exec onlyoffice-prod pg_lsclusters
}
Write-Host 'Read-only checks complete. On the owner machine, also test the peer backend callback URL from Docker.'
