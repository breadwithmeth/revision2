import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryServiceV2, UpdateItemsPayloadV2 } from '../services/inventory.service.v2.js';
import { ApiError } from '../services/inventory.service.js';

export async function inventoryItemsV2Route(fastify: FastifyInstance) {
  // Новый эндпоинт с поддержкой merge
  fastify.patch('/inventory-documents/:id/items/v2', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const payload = request.body as UpdateItemsPayloadV2;

      if (!id) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Document ID is required',
        });
      }

      if (!payload.version || !Array.isArray(payload.items)) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Version and items array are required',
        });
      }

  const result = await InventoryServiceV2.updateItemsWithMerge(id, payload);
  return reply.status(200).send(result);
    } catch (error) {
      const apiError = error as any;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'CONFLICT' ? 409 :
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Update items v2 error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });

  // Эндпоинт получения документа с timestamps
  fastify.get('/inventory-documents/:id/with-timestamps', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Document ID is required',
        });
      }

      const document = await InventoryServiceV2.getDocumentWithTimestamps(id);
      return reply.status(200).send(document);
    } catch (error) {
      const apiError = error as any;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Get document with timestamps error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
