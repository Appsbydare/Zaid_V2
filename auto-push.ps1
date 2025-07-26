while ($true) {
    git add .
    git commit -m "Auto-commit: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" --allow-empty
    git push
    Start-Sleep -Seconds 300  # Wait 5 minutes
} 