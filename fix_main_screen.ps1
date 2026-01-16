$path = 'd:\Docment\GitHub\fiction_fleet_placer\fiction_fleet_placer\src\components\MainScreen.jsx'
$content = Get-Content $path
# Keep lines 1-1667 (Indices 0..1666)
# Skip lines 1668-1785 (Indices 1667..1784)
# Keep lines 1786-End (Indices 1785..End)
$newContent = $content[0..1666] + $content[1785..($content.Length-1)]
$newContent | Set-Content $path -Encoding UTF8
Write-Host "Fixed MainScreen.jsx"
