import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryService, ImportPayload, ApiError } from '../services/inventory.service.js';

export async function onecImportRoute(fastify: FastifyInstance) {
  fastify.post('/onec/inventory-documents/import', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = request.body as ImportPayload;

      // Basic validation
      if (!payload.externalId || !payload.onecNumber || !payload.onecDate || !payload.warehouse?.code || !payload.items) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Missing required fields',
        });
      }

      if (!Array.isArray(payload.items)) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Items must be an array',
        });
      }

      // Validate items
      for (const item of payload.items) {
        if (!item.sku || !item.name || !item.unit || !item.qtyFrom1C || !Array.isArray(item.barcodes)) {
          return reply.status(400).send({
            code: 'BAD_REQUEST',
            message: 'Invalid item format',
          });
        }

        // Validate quantity is a valid number
        if (isNaN(parseFloat(item.qtyFrom1C))) {
          return reply.status(400).send({
            code: 'BAD_REQUEST',
            message: `Invalid qtyFrom1C for item ${item.sku}`,
          });
        }
      }

      const result = await InventoryService.importFrom1C(payload);
      return reply.status(200).send(result);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Import error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
