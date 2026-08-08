/** Dias de validade gratuita de um anúncio. */
export const LISTING_TTL_DAYS = 15;

/**
 * Após o fim da validade, dias de graça antes de apagar do banco
 * (15 + 2 = 17 dias sem renovação paga).
 */
export const LISTING_PURGE_GRACE_DAYS = 2;

/** Valor da renovação (+15 dias), 100% plataforma. */
export const LISTING_RENEWAL_PRICE_BRL = 15;

export function addListingTtlDays(
  from: Date,
  days: number = LISTING_TTL_DAYS
): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Próximo expiresAt após renovação: max(agora, expiresAt) + TTL. */
export function computeRenewedExpiresAt(
  currentExpiresAt: string | Date | null | undefined,
  now: Date = new Date()
): Date {
  const current =
    currentExpiresAt != null ? new Date(currentExpiresAt) : null;
  const base =
    current && !Number.isNaN(current.getTime()) && current.getTime() > now.getTime()
      ? current
      : now;
  return addListingTtlDays(base);
}
