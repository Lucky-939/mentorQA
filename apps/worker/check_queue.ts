import { Queue } from 'bullmq';
import IORedis from 'ioredis';

async function main() {
  const connection = new IORedis('redis://localhost:6380');
  const queue = new Queue('review-pipeline', { connection });
  const failedJobs = await queue.getFailed();
  if (failedJobs.length > 0) {
    const job = failedJobs[failedJobs.length - 1];
    console.log('Failed Job ID:', job.id);
    console.log('Failed Reason:', job.failedReason);
    console.log('Stack Trace:', job.stacktrace);
  } else {
    console.log('No failed jobs in queue');
  }
  connection.disconnect();
}
main().catch(console.error);
