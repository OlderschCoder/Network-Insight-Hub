# Set DPI Awareness explicitly (must be at the very top of the script!)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

Add-Type @"
using System.Runtime.InteropServices;
public class DPIAwareness {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DPIAwareness]::SetProcessDPIAware() | Out-Null



Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Set global font explicitly
$globalFont = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Regular)

# Main Form
$form = New-Object System.Windows.Forms.Form
$form.Text = "Network Printer Installer"
$form.ClientSize = New-Object System.Drawing.Size(1200, 800)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = $globalFont

# Input Fields and Labels
$fields = @(
    "Enter the full name of the printer you want to install:",
    "Enter the IP address of the printer:",
    "Enter the exact driver name on the system:",
    "Enter the physical or logical location of the printer:",
    "Enter any additional comment for this printer:"
)

$inputs = @()
$y = 30

foreach ($fieldText in $fields) {
    # Label with explicit Font
    $label = New-Object System.Windows.Forms.Label
    $label.AutoSize = $false
    $label.Text = $fieldText
    $label.Location = New-Object System.Drawing.Point(20, $y)
    $label.Size = New-Object System.Drawing.Size(700, 40)
    $label.TextAlign = 'MiddleLeft'
    $label.Font = $globalFont
    $form.Controls.Add($label)

    # TextBox with Multiline explicitly set BEFORE font
    $textbox = New-Object System.Windows.Forms.TextBox
    $textbox.Multiline = $true
    $textbox.Location = New-Object System.Drawing.Point(730, $y)
    $textbox.Size = New-Object System.Drawing.Size(440, 70)
    # Explicitly set Font AFTER Multiline and Size to ensure correctness
    $textbox.Font = $globalFont
    $form.Controls.Add($textbox)

    $inputs += $textbox
    $y += 110
}

# Install Button with explicit Font
$button = New-Object System.Windows.Forms.Button
$button.Text = "Install Printer"
$button.Location = New-Object System.Drawing.Point(500, ($y + 10))
$button.Size = New-Object System.Drawing.Size(200, 55)
$button.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($button)

# Output Label with explicit Font
$outputLabel = New-Object System.Windows.Forms.Label
$outputLabel.Location = New-Object System.Drawing.Point(20, ($y + 90))
$outputLabel.Size = New-Object System.Drawing.Size(1150, 100)
$outputLabel.ForeColor = "Blue"
$outputLabel.TextAlign = 'TopLeft'
$outputLabel.Font = $globalFont
$form.Controls.Add($outputLabel)

# Button Click Event
$button.Add_Click({
    $PrinterName = $inputs[0].Text
    $PrinterIP = $inputs[1].Text
    $PortName = "IP_$PrinterIP"
    $DriverName = $inputs[2].Text
    $Location = $inputs[3].Text
    $Comment = $inputs[4].Text

    try {
        if ((Get-Service spooler).Status -ne 'Running') {
            Start-Service spooler
        }

        if (-not (Get-PrinterPort -Name $PortName -ErrorAction SilentlyContinue)) {
            Add-PrinterPort -Name $PortName -PrinterHostAddress $PrinterIP
        }

        if (-not (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue)) {
            Add-Printer -Name $PrinterName `
                        -DriverName $DriverName `
                        -PortName $PortName `
                        -Location $Location `
                        -Comment $Comment
        }

        Restart-Service -Name spooler -Force
        Start-Sleep -Seconds 2

        if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) {
            $outputLabel.ForeColor = "Green"
            $outputLabel.Text = "✅ Printer '$PrinterName' installed successfully."
        } else {
            $outputLabel.ForeColor = "Red"
            $outputLabel.Text = "❌ Printer '$PrinterName' not found after setup."
        }
    } catch {
        $outputLabel.ForeColor = "Red"
        $outputLabel.Text = "❌ Error: $($_.Exception.Message)"
    }
})

# Show the form
$form.Topmost = $true
[void]$form.ShowDialog()
