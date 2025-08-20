import Fastify from 'fastify';
import { prisma } from './prisma.js';
import { onecImportRoute } from './routes/onec.import.js';
import { inventoryGetRoute } from './routes/inventory.get.js';
import { inventoryListRoute } from './routes/inventory.list.js';
import { inventoryItemsRoute } from './routes/inventory.items.js';
import { inventoryItemsV2Route } from './routes/inventory.items.v2.js';
import { inventoryReviseRoute } from './routes/inventory.revise.js';
import { onecExportRoute } from './routes/onec.export.js';
import { onecAckRoute } from './routes/onec.ack.js';
import { warehouseListRoute } from './routes/warehouse.list.js';

const PORT = parseInt(process.env.PORT || '3000');

const fastify = Fastify({ logger: false });

// CORS: разрешить запросы с любого сайта (без внешних зависимостей)
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  reply.header('Access-Control-Max-Age', '86400');
  return payload;
});

fastify.options('*', async (request, reply) => {
  reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    .header('Access-Control-Max-Age', '86400')
    .status(204)
    .send();
});

// Регистрация роутов
fastify.register(onecImportRoute);
fastify.register(inventoryGetRoute);
fastify.register(inventoryListRoute);
fastify.register(inventoryItemsRoute);
fastify.register(inventoryItemsV2Route);
fastify.register(inventoryReviseRoute);
fastify.register(onecExportRoute);
fastify.register(onecAckRoute);
fastify.register(warehouseListRoute);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${PORT}`);
  } catch (err) {
    console.error('Error starting server:', err);
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
