param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Body = $env:API_TEST_BODY
)

$baseUrl = if ($env:API_BASE_URL) { $env:API_BASE_URL.TrimEnd('/') } else { 'http://127.0.0.1:3001' }
$Path = $Path.Replace('{id}', [uri]::EscapeDataString($(if ($env:API_TEST_ID) { $env:API_TEST_ID } else { 'replace-me' })))
$Path = $Path.Replace('{name}', [uri]::EscapeDataString($(if ($env:API_TEST_NAME) { $env:API_TEST_NAME } else { 'replace-me' })))
$Path = $Path.Replace('{code}', [uri]::EscapeDataString($(if ($env:API_TEST_CODE) { $env:API_TEST_CODE } else { 'replace-me' })))
$headers = @{}
if ($env:API_COOKIE) { $headers.Cookie = $env:API_COOKIE }
if ($env:ADMIN_API_TOKEN) { $headers['x-admin-token'] = $env:ADMIN_API_TOKEN }
$parameters = @{
    Uri = "$baseUrl$Path"
    Method = $Method
    Headers = $headers
    UseBasicParsing = $true
}
if ($Method -in @('POST', 'PUT', 'PATCH') -and $null -ne $Body) {
    if (-not $Body) { $Body = '{}' }
    $parameters.ContentType = 'application/json'
    $parameters.Body = $Body
}
try {
    $response = Invoke-WebRequest @parameters
    "HTTP $([int]$response.StatusCode) $Method $Path"
    $response.Content
} catch {
    $response = $_.Exception.Response
    if ($response) {
        $status = [int]$response.StatusCode
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        $content = $reader.ReadToEnd()
        "HTTP $status $Method $Path"
        $content
    } else {
        throw
    }
}
