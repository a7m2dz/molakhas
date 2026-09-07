import { configured, fccRequest, listModels } from './fcc-client.mjs';

if (!configured()) {
  console.error('FCC_BASE_URL is not configured.');
  process.exit(1);
}

try {
  const models = await listModels();
  const count = Array.isArray(models?.data) ? models.data.length : 0;
  console.log(`FCC models endpoint OK (${count} models).`);
  const result = await fccRequest('أجب بكلمة واحدة فقط دون علامات ترقيم: جاهز');
  console.log('FCC response OK:', result.slice(0, 120));
} catch (error) {
  console.error('FCC test failed:', error.message);
  process.exit(1);
}
