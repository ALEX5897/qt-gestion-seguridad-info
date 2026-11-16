import { checkServiceability } from './serviceability';

const now = new Date('2026-11-15T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe('checkServiceability', () => {
  it('un local suspendido nunca se atiende', () => {
    const r = checkServiceability(
      { status: 'SUSPENDED', trialEndsAt: null },
      { status: 'ACTIVE', currentPeriodEnd: days(20), graceDays: 5 },
      now,
    );
    expect(r).toEqual({ serviceable: false, reason: 'SUSPENDED' });
  });

  it('prueba vigente se atiende; vencida no', () => {
    expect(checkServiceability({ status: 'TRIAL', trialEndsAt: days(3) }, null, now).serviceable).toBe(true);
    expect(checkServiceability({ status: 'TRIAL', trialEndsAt: days(-1) }, null, now).reason).toBe('TRIAL_EXPIRED');
  });

  it('activo sin suscripción no se atiende', () => {
    expect(checkServiceability({ status: 'ACTIVE', trialEndsAt: null }, null, now).reason).toBe('NO_SUBSCRIPTION');
  });

  it('respeta los días de gracia después del vencimiento', () => {
    const t = { status: 'ACTIVE' as const, trialEndsAt: null };
    expect(
      checkServiceability(t, { status: 'PAST_DUE', currentPeriodEnd: days(-3), graceDays: 5 }, now).serviceable,
    ).toBe(true);
    expect(checkServiceability(t, { status: 'PAST_DUE', currentPeriodEnd: days(-6), graceDays: 5 }, now).reason).toBe(
      'EXPIRED',
    );
  });
});
