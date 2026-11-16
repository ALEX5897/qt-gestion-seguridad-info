// Sesión del usuario: token guardado en el dispositivo y datos del local.
export interface SessionUser { id: number; name: string; email: string; role: 'SUPERADMIN' | 'OWNER' | 'STAFF'; tenantId: number | null }
export interface Me {
  user: SessionUser;
  tenant: Record<string, any> | null;
  subscription: { serviceable: boolean; reason: string; plan: string | null; validUntil: string | null } | null;
}

const TOKEN_KEY = 'agenda.token';

export function useSession() {
  const token = useState<string | null>('token', () => (import.meta.client ? localStorage.getItem(TOKEN_KEY) : null));
  const me = useState<Me | null>('me', () => null);

  function setToken(value: string | null) {
    token.value = value;
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function loadMe() {
    me.value = await useApi()<Me>('/me');
    return me.value;
  }

  function logout() {
    setToken(null);
    me.value = null;
    return navigateTo('/login');
  }

  const tz = computed(() => me.value?.tenant?.timezone ?? 'America/Guayaquil');
  const isOwner = computed(() => me.value?.user.role === 'OWNER');

  return { token, me, setToken, loadMe, logout, tz, isOwner };
}
