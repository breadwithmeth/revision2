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

const PORT = parseInt(process.env.PORT || '3000');

const fastify = Fastify({ logger: false });

// Регистрация роутов
fastify.register(onecImportRoute);
fastify.register(inventoryGetRoute);
fastify.register(inventoryListRoute);
fastify.register(inventoryItemsRoute);
fastify.register(inventoryItemsV2Route);
fastify.register(inventoryReviseRoute);
fastify.register(onecExportRoute);
fastify.register(onecAckRoute);

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
