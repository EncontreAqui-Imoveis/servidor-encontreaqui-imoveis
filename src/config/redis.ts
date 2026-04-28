import { ConnectionOptions } from 'bullmq';

// Railway and other providers often provide a single REDIS_URL
const redisUrl = process.env.REDIS_URL;

export const redisConfig: ConnectionOptions = redisUrl 
  ? { url: redisUrl }
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      username: process.env.REDIS_USERNAME || undefined,
      maxRetriesPerRequest: null,
    };

