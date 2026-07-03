import { env } from './config/env';
import app from './app';

app.listen(env.port, () => {
  console.log(`\n🚀 Savora Backend running on port ${env.port}`);
  console.log(`   Environment : ${env.nodeEnv}`);
  console.log(`   Health      : http://localhost:${env.port}/health`);
  console.log(`   Auth        : http://localhost:${env.port}/auth\n`);
});
