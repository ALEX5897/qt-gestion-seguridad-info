// Cliente de la API: agrega el token y convierte los errores en mensajes legibles.
export function useApi() {
  const base = useRuntimeConfig().public.apiBase as string;
  const { token, logout } = useSession();

  return async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    try {
      return await $fetch<T>(base + path, {
        method: (opts.method ?? 'GET') as any,
        body: opts.body as any,
        headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
      });
    } catch (e: any) {
      if (e?.status === 401 && token.value) await logout();
      const msg = e?.data?.message;
      throw new Error(Array.isArray(msg) ? msg.join('. ') : msg || 'No se pudo conectar con el servidor');
    }
  };
}
