import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryService, ApiError } from '../services/inventory.service.js';

export async function inventoryListRoute(fastify: FastifyInstance) {
  fastify.get('/inventory-documents/warehouse/:warehouseCode', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { warehouseCode } = request.params as { warehouseCode: string };

      if (!warehouseCode) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Warehouse code is required',
        });
      }

      const documents = await InventoryService.getDocumentsByWarehouse(warehouseCode);
      return reply.status(200).send(documents);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Get documents by warehouse error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
