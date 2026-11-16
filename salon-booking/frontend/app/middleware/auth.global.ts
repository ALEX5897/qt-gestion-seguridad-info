// Exige sesión en todo menos /login y separa el panel del administrador del panel del local.
export default defineNuxtRouteMiddleware(async (to) => {
  const { token, me, loadMe, setToken } = useSession();
  if (to.path === '/login') return;
  if (!token.value) return navigateTo('/login');
  if (!me.value) {
    try {
      await loadMe();
    } catch {
      setToken(null);
      return navigateTo('/login');
    }
  }
  const isAdmin = me.value?.user.role === 'SUPERADMIN';
  if (isAdmin && !to.path.startsWith('/admin')) return navigateTo('/admin');
  if (!isAdmin && to.path.startsWith('/admin')) return navigateTo('/');
});
