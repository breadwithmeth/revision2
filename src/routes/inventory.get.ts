import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryService, ApiError } from '../services/inventory.service.js';

export async function inventoryGetRoute(fastify: FastifyInstance) {
  fastify.get('/inventory-documents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Document ID is required',
        });
      }

      const document = await InventoryService.getDocument(id);
      return reply.status(200).send(document);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Get document error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
