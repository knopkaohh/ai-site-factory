import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/database';

const config = loadConfig();
const database = openDatabase(config.databasePath);
const app = createApp({
  database,
  version: config.version,
  databaseLocation: config.databaseLocation,
  frontendDist: config.frontendDist,
});

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`AI Site Factory API: http://127.0.0.1:${config.port}`);
  console.log(`База данных: ${config.databasePath}`);
});

function shutdown(signal: string): void {
  console.log(`Остановка (${signal})`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
