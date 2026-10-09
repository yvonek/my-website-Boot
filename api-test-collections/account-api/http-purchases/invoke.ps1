$body = if ($env:API_TEST_BODY) { $env:API_TEST_BODY } else { '{}' }
$payload = ConvertFrom-Json -InputObject $body
if (-not $payload.idempotencyKey) {
	$key = if ($env:API_TEST_IDEMPOTENCY_KEY) { $env:API_TEST_IDEMPOTENCY_KEY } else { [guid]::NewGuid().ToString() }
	$payload | Add-Member -MemberType NoteProperty -Name idempotencyKey -Value $key -Force
}
$body = ConvertTo-Json -InputObject $payload -Depth 20 -Compress
& (Join-Path $PSScriptRoot '..\invoke-api.ps1') -Method 'POST' -Path '/api/purchases' -Body $body
