import { execSync } from 'child_process';

try {
  execSync('npx node server.ts', { env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' });
} catch (e) {
  console.error('Error:', e.message);
}
