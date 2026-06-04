const { execSync } = require('child_process');
const os = require('os');

class SourceDetector {
  constructor() {
    this.activeWin = null;
    this.initFailed = false;
  }

  async getActiveWindow() {
    if (os.platform() === 'win32') {
      return this._getActiveWindowWindows();
    } else if (os.platform() === 'darwin') {
      return this._getActiveWindowMac();
    } else {
      return this._getActiveWindowLinux();
    }
  }

  _getActiveWindowWindows() {
    try {
      const psCode = `
        Add-Type '[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);';
        $hWnd = [Win32.NativeMethods]::GetForegroundWindow();
        $sb = New-Object System.Text.StringBuilder(256);
        [Win32.NativeMethods]::GetWindowText($hWnd, $sb, 256) | Out-Null;
        $title = $sb.ToString();
        $pid = 0;
        [Win32.NativeMethods]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null;
        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue;
        $appName = if ($process) { $process.MainModule.ModuleName } else { 'Unknown' };
        if ($title) { "$appName - $title" } else { $appName }
      `;
      
      const result = execSync(`powershell -Command "${psCode.replace(/"/g, '""')}"`, {
        timeout: 1000,
        encoding: 'utf8'
      }).trim();
      
      return result || 'Unknown';
    } catch (err) {
      return this._tryAlternativeWindows();
    }
  }

  _tryAlternativeWindows() {
    try {
      const result = execSync('powershell -Command "(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1).ProcessName"', {
        timeout: 1000,
        encoding: 'utf8'
      }).trim();
      return result || 'Unknown';
    } catch (err) {
      return 'Unknown';
    }
  }

  _getActiveWindowMac() {
    try {
      const script = 'tell application "System Events" to get name of first application process whose frontmost is true';
      const result = execSync(`osascript -e '${script}'`, {
        timeout: 1000,
        encoding: 'utf8'
      }).trim();
      return result || 'Unknown';
    } catch (err) {
      return 'Unknown';
    }
  }

  _getActiveWindowLinux() {
    try {
      const windowId = execSync('xdotool getactivewindow 2>/dev/null', {
        timeout: 1000,
        encoding: 'utf8'
      }).trim();
      
      if (windowId) {
        const windowName = execSync(`xdotool getwindowname ${windowId} 2>/dev/null`, {
          timeout: 1000,
          encoding: 'utf8'
        }).trim();
        return windowName || 'Unknown';
      }
    } catch (err) {
      // xdotool not available
    }
    return 'Unknown';
  }
}

module.exports = SourceDetector;
