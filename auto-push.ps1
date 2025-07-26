while ($true) {
    git add .
    git commit -m "Auto-commit: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" --allow-empty
    git push --set-upstream origin modifications 2>$null
    if ($LASTEXITCODE -eq 0) {
        # If successful, switch to regular push for future runs
        git push
    }
    Start-Sleep -Seconds 300  # Wait 5 minutes
} 