import { configured, fccRequest } from './fcc-client.mjs';
if (!configured()) { console.log('FCC not configured; skipping test.'); process.exit(0); }
try {
  const result = await fccRequest('أجب بكلمة واحدة فقط: جاهز');
  console.log('FCC OK:', result.slice(0,100));
} catch (error) {
  console.error(error);
  process.exit(1);
}
