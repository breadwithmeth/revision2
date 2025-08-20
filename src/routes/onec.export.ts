import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InventoryService, ApiError } from '../services/inventory.service.js';

export async function onecExportRoute(fastify: FastifyInstance) {
fastify.get('/onec/inventory-documents/:id/export', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Document ID is required',
        });
      }

      const result = await InventoryService.exportFor1C(id);
      return reply.status(200).send(result);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code) {
        const statusCode = apiError.code === 'NOT_FOUND' ? 404 : 
                          apiError.code === 'UNPROCESSABLE_ENTITY' ? 422 :
                          apiError.code === 'BAD_REQUEST' ? 400 : 500;
        return reply.status(statusCode).send(apiError);
      }
      
      console.error('Export error:', error);
      return reply.status(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
}
