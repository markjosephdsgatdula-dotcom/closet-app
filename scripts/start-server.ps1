$appDir = "C:\Users\markj\OneDrive\Desktop\Claude Projects\Ideas research\closet-app"
$logDir = Join-Path $appDir ".server-logs"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

Start-Process -FilePath "pythonw" `
  -ArgumentList "-m", "http.server", "8123" `
  -WorkingDirectory $appDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "out.log") `
  -RedirectStandardError (Join-Path $logDir "err.log")
