import { SubscriptionStatus, TenantStatus } from '@prisma/client';

export interface TenantForCheck {
  status: TenantStatus;
  trialEndsAt: Date | null;
}

export interface SubscriptionForCheck {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  graceDays: number;
}

export type ServiceabilityReason = 'OK' | 'SUSPENDED' | 'TRIAL_EXPIRED' | 'NO_SUBSCRIPTION' | 'EXPIRED';

/**
 * Decide si el bot debe atender a los clientes de un local.
 * Solo se atiende a locales en prueba vigente o con suscripción pagada
 * (vencimiento + días de gracia). El administrador puede suspender en cualquier momento.
 */
export function checkServiceability(
  tenant: TenantForCheck,
  latestSubscription: SubscriptionForCheck | null,
  now: Date,
): { serviceable: boolean; reason: ServiceabilityReason } {
  if (tenant.status === 'SUSPENDED') return { serviceable: false, reason: 'SUSPENDED' };

  if (tenant.status === 'TRIAL') {
    const ok = !tenant.trialEndsAt || tenant.trialEndsAt.getTime() >= now.getTime();
    return ok ? { serviceable: true, reason: 'OK' } : { serviceable: false, reason: 'TRIAL_EXPIRED' };
  }

  if (!latestSubscription || latestSubscription.status === 'CANCELLED') {
    return { serviceable: false, reason: 'NO_SUBSCRIPTION' };
  }

  const limit = latestSubscription.currentPeriodEnd.getTime() + latestSubscription.graceDays * 86_400_000;
  return limit >= now.getTime() ? { serviceable: true, reason: 'OK' } : { serviceable: false, reason: 'EXPIRED' };
}
