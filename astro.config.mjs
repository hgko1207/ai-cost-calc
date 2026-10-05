import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// 기본값은 GitHub Pages 주소. 다른 호스팅(Cloudflare Pages 등)으로 옮기면
// SITE_URL=https://example.pages.dev BASE_PATH=/ 처럼 환경 변수로 바꾼다.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://hgko1207.github.io',
  base: process.env.BASE_PATH ?? '/ai-cost-calc',
  integrations: [react(), sitemap()],
});
