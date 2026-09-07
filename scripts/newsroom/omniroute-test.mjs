import { configured, listModels, omniRequest } from './omniroute-client.mjs';

if (!configured()) {
  console.error('OMNIROUTE_BASE_URL is not configured.');
  process.exit(1);
}

try {
  const models = await listModels();
  const count = Array.isArray(models?.data) ? models.data.length : 0;
  console.log(`OmniRoute models endpoint OK (${count} models).`);
  const result = await omniRequest('أجب بكلمة واحدة فقط دون علامات ترقيم: جاهز');
  console.log('OmniRoute response OK:', result.slice(0, 160));
} catch (error) {
  console.error('OmniRoute test failed:', error.message);
  process.exit(1);
}
