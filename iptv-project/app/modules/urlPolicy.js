const SENSITIVE_KEYS = /^(?:account|apikey|auth|authorization|cookie|credential|password|passwd|secret|session|signature|sig|token|txsecret|streamkey|streamid|migutoken|wstime|wssecret)$/i;

export function sanitizeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    [...parsed.searchParams.keys()].forEach((key) => {
      if (SENSITIVE_KEYS.test(key) || /token|secret|auth|key|sig/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    });
    parsed.pathname = parsed.pathname
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        let decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch {}
        return /token|secret|auth|account|credential|password|passwd|signature|sig|streamkey|streamid|migutoken|wstime|wssecret/i.test(decoded)
          ? '[redacted]'
          : segment;
      })
      .join('/');
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '[redacted-url]';
  }
}
