import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryService, UpdateItemsPayload, ApiError } from '../services/inventory.service.js';

export async function inventoryItemsRoute(fastify: FastifyInstance) {
  fastify.patch('/inventory-documents/:id/items', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const payload = request.body as UpdateItemsPayload;

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

      if (typeof payload.version !== 'number') {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Version must be a number',
        });
      }

      // Validate items
      for (const item of payload.items) {
        if (!item.sku && !item.barcode) {
          return reply.status(400).send({
            code: 'BAD_REQUEST',
            message: 'Either sku or barcode must be provided for each item',
          });
        }

        // Validate quantities are valid numbers if provided
        if (item.countedQty !== undefined && isNaN(parseFloat(item.countedQty))) {
          return reply.status(400).send({
            code: 'BAD_REQUEST',
            message: 'Invalid countedQty format',
          });
        }

        if (item.correctedQty !== undefined && isNaN(parseFloat(item.correctedQty))) {
          return reply.status(400).send({
            code: 'BAD_REQUEST',
            message: 'Invalid correctedQty format',
          });
        }
      }

      const result = await InventoryService.updateItems(id, payload);
      return reply.status(200).send(result);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'CONFLICT' ? 409 :
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Update items error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
