import { defineConfig } from 'astro/config';

const site = 'https://mulakhas.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never'
});
