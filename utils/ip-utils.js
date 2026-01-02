function normalizeIP(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

function isLocal192(ip) {
  return /^192\.168\./.test(ip);
}

function isLocalIP(ip) {
  if (!ip || ip === 'unknown') return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || isLocal192(ip);
}

function pickForwardedIP(headerValue) {
  if (!headerValue) return null;
  const parts = headerValue
    .split(',')
    .map((p) => normalizeIP(p.trim()))
    .filter(Boolean);
  for (const ip of parts) {
    if (!isLocal192(ip)) return ip;
  }
  return parts[0] || null;
}

function getClientIP(req, socket, disableLocalFilter = false) {
  const xfwd = pickForwardedIP(req?.headers?.['x-forwarded-for']);
  if (xfwd && (disableLocalFilter || !isLocal192(xfwd))) return xfwd;

  const cfip = normalizeIP(req?.headers?.['cf-connecting-ip']);
  if (cfip && cfip !== 'unknown' && (disableLocalFilter || !isLocal192(cfip))) return cfip;

  const cfipv6 = normalizeIP(req?.headers?.['cf-connecting-ipv6']);
  if (cfipv6 && cfipv6 !== 'unknown' && (disableLocalFilter || !isLocal192(cfipv6))) return cfipv6;

  const remote = normalizeIP(socket?.remoteAddress || req?.socket?.remoteAddress);
  if (remote && remote !== 'unknown' && (disableLocalFilter || !isLocal192(remote))) return remote;

  return 'unknown';
}

const isValidIP = (ip) => ip && ip !== 'unknown';

module.exports = {
  isValidIP,
  normalizeIP,
  isLocal192,
  isLocalIP,
  pickForwardedIP,
  getClientIP
};
