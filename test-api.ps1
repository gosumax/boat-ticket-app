# PowerShell script to test the API endpoints

# Login and get token
Write-Host "Logging in..."
$loginBody = @{
    username = "admin"
    password = "1"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3001/api/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
    $token = $loginResponse.token
    Write-Host "Login successful. Token: $($token.Substring(0, 20))..."
}
catch {
    Write-Host "Login failed: $($_.Exception.Message)"
    Write-Host "Response: $($_.ErrorDetails.Message)"
    exit 1
}

# Use token to call selling/slots endpoint
Write-Host "`nFetching selling slots..."
$headers = @{
    Authorization = "Bearer $token"
}

try {
    $slotsResponse = Invoke-RestMethod -Uri "http://localhost:3001/api/selling/slots" -Method Get -Headers $headers
    Write-Host "Slots response:"
    $slotsResponse | ConvertTo-Json -Depth 5
}
catch {
    Write-Host "Slots request failed: $($_.Exception.Message)"
    Write-Host "Response: $($_.ErrorDetails.Message)"
    exit 1
}