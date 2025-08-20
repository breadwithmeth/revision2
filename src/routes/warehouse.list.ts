import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryService } from '../services/inventory.service.js';

export async function warehouseListRoute(fastify: FastifyInstance) {
  fastify.get('/warehouses', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await InventoryService.listWarehouses();
      return reply.status(200).send(data);
    } catch (error) {
      console.error('List warehouses error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
