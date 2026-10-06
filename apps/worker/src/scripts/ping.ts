// Enqueues a ping job and waits for a running worker to process it.
import { QueueEvents } from 'bullmq';
import { QUEUES, createRedis, createSystemQueue, loadEnv } from '@agentos/core';

const env = loadEnv();
const connection = createRedis(env.REDIS_URL);
// QueueEvents needs its own connection: it blocks on the events stream.
const eventsConnection = createRedis(env.REDIS_URL);
const queue = createSystemQueue(connection);
const events = new QueueEvents(QUEUES.system, { connection: eventsConnection });

try {
  await events.waitUntilReady();
  const job = await queue.add('ping', { requestedAt: new Date().toISOString() });
  const result = await job.waitUntilFinished(events, 10_000);
  console.log('ping ok:', result);
} catch (error) {
  console.error('ping failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await Promise.all([queue.close(), events.close()]);
  connection.disconnect();
  eventsConnection.disconnect();
}
