const REDACTED = '[REDACTED]';

const SECRET_ASSIGNMENT_PATTERNS = [
  /\b(password|passwordHash|token|tokenHash|refreshToken|accessToken|apiKey|apiSecret|secret|authorization|pairingCode|enrollmentCode)\b\s*[:=]\s*["']?[^"',\s)}\]]+/gi,
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
  /["']?\b(x-msaidizi-evaluation-lease)\b["']?\s*[:=]\s*["']?[^"',\s)}\]]+/gi,
];

export function scrubLogText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text = String(value);
  for (const pattern of SECRET_ASSIGNMENT_PATTERNS) {
    text = text.replace(pattern, (match, key) => {
      if (String(key).toLowerCase() === 'bearer') return 'Bearer [REDACTED]';
      const separator = match.includes('=') ? '=' : ':';
      return `${key}${separator}${REDACTED}`;
    });
  }
  return text;
}
