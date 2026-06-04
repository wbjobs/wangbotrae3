export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
}

export function bytesToAscii(bytes: number[]): string {
  return bytes.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
}

export function formatHexView(bytes: number[], bytesPerLine: number = 16): { offset: string; hex: string; ascii: string }[] {
  const lines: { offset: string; hex: string; ascii: string }[] = [];
  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const lineBytes = bytes.slice(i, i + bytesPerLine);
    const offset = i.toString(16).padStart(8, '0');
    const hex = lineBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = lineBytes.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
    lines.push({ offset, hex, ascii });
  }
  return lines;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function textToBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export function bytesToText(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function ipcTypeClass(type: string): string {
  switch (type) {
    case 'UnixDomainSocket': return 'unix';
    case 'DBus': return 'dbus';
    case 'Pipe': return 'pipe';
    default: return 'unix';
  }
}

export function ipcTypeLabel(type: string): string {
  switch (type) {
    case 'UnixDomainSocket': return 'UNIX';
    case 'DBus': return 'DBUS';
    case 'Pipe': return 'PIPE';
    default: return type;
  }
}

export function truncateBytes(bytes: number[], maxLen: number = 80): string {
  const text = bytesToText(bytes);
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
