import 'dotenv/config';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  console.log('🔄 MentorQA Worker starting...');

  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // required for BullMQ compatibility in future phases
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      console.log(`Redis connection retry #${times} in ${delay}ms...`);
      return delay;
    },
  });

  redis.on('connect', () => {
    console.log('✅ Redis connected');
    console.log('✅ Worker ready — waiting for jobs (Phase 1+ will register queues here)');
  });

  redis.on('error', (err) => {
    console.error('❌ Redis error:', err.message);
  });

  // Keep process alive
  process.on('SIGTERM', async () => {
    console.log('\nSIGTERM received. Shutting down worker...');
    await redis.quit();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\nSIGINT received. Shutting down worker...');
    await redis.quit();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
