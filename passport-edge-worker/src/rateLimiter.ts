const rateLimitCache = new Map<string, { count: number; expiresAt: number }>();

export function checkEmailRateLimit(email: string): boolean {
  const normalizedEmail = email.toLowerCase();
  const now = Date.now();
  const limitWindow = 5 * 60 * 1000; // 5 minutes

  const entry = rateLimitCache.get(normalizedEmail);

  if (!entry || entry.expiresAt < now) {
    rateLimitCache.set(normalizedEmail, { count: 1, expiresAt: now + limitWindow });
    return true; // Allowed
  }

  if (entry.count >= 3) {
    return false; // Blocked
  }

  entry.count += 1;
  return true; // Allowed
}
