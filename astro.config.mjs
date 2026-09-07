import { defineConfig } from 'astro/config';

const site = process.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never'
});
