import { config } from './config.js';
import { getDb } from './db.js';
import { AppError } from './providers.js';

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function planLimits(plan) {
  return config.limits[plan] || config.limits.free;
}

export function usageFor(userId, feature) {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS used FROM usage_events WHERE user_id = ? AND feature = ? AND day = ?')
    .get(userId, feature, today());
  return row?.used || 0;
}

export function usageSummary(user) {
  const limits = planLimits(user.plan);
  const out = {};
  for (const feature of Object.keys(limits)) {
    out[feature] = {
      used: usageFor(user.id, feature),
      limit: limits[feature],
    };
  }
  return out;
}

/**
 * Reserves one unit of a feature for today. Throws 429 when the plan limit is
 * reached so the UI can show an honest upgrade message.
 */
export function consume(user, feature, amount = 1) {
  const limits = planLimits(user.plan);
  const limit = limits[feature];
  if (limit === undefined) return { used: 0, limit: null };
  const used = usageFor(user.id, feature);
  if (used + amount > limit) {
    throw new AppError(
      `Daily ${feature} limit reached (${limit} on the ${user.plan} plan). Try again tomorrow or upgrade to Premium.`,
      { status: 429, code: 'LIMIT_REACHED' },
    );
  }
  getDb()
    .prepare('INSERT INTO usage_events (user_id, feature, day, amount) VALUES (?, ?, ?, ?)')
    .run(user.id, feature, today(), amount);
  return { used: used + amount, limit };
}
