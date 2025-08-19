import Fastify from 'fastify';

const PORT = parseInt(process.env.PORT || '3000');

const fastify = Fastify({ logger: false });

// Простой тестовый роут
fastify.get('/health', async (request, reply) => {
  return { status: 'OK', timestamp: new Date().toISOString() };
});

// Тестовый роут для списка документов
fastify.get('/inventory-documents/warehouse/:warehouseCode', async (request, reply) => {
  const { warehouseCode } = request.params as { warehouseCode: string };
  
  return {
    warehouseCode,
    documents: [
      {
        id: 'test-1',
        externalId: 'ext-1',
        onecNumber: 'ПР-000001',
        status: 'IMPORTED',
        createdAt: new Date().toISOString(),
        items: []
      }
    ]
  };
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Test server listening on port ${PORT}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
