// Panel web (PWA) para el dueño del local y el administrador general.
// Es una SPA: se genera como archivos estáticos y habla con la API del backend.
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  runtimeConfig: {
    public: {
      // URL de la API; se puede cambiar con NUXT_PUBLIC_API_BASE
      apiBase: 'http://localhost:3001/api',
    },
  },
  app: {
    head: {
      title: 'Agenda del local',
      htmlAttrs: { lang: 'es' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#7c3aed' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'apple-touch-icon', href: '/icon-192.png' },
      ],
    },
  },
});
