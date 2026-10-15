function normalizeLinkedinIdentifier(input, kind) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('LinkedIn URL is required.');
  }

  const value = input.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const url = new URL(hasScheme ? value : `https://${value}`);
  const validProtocol = ['https:', 'http:'].includes(url.protocol);
  const validHost = /^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname);
  if (!validProtocol || !validHost || url.username || url.password || url.port) {
    throw new Error('Invalid LinkedIn host.');
  }

  const path = new RegExp(`^/${kind}/([^/]+)/?$`).exec(url.pathname);
  const slug = path && decodeURIComponent(path[1]).normalize('NFC').toLowerCase();
  if (!slug || !/^[\p{L}\p{N}_-]+$/u.test(slug)) {
    throw new Error(`Invalid LinkedIn ${kind} URL.`);
  }
  return `https://www.linkedin.com/${kind}/${encodeURIComponent(slug)}`;
}

export function normalizeLinkedinUrl(input) {
  return normalizeLinkedinIdentifier(input, 'in');
}

export function normalizeCompanyLinkedinUrl(input) {
  return normalizeLinkedinIdentifier(input, 'company');
}

export function normStr(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(inc|llc|corp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
