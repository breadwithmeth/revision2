import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

export interface ImportPayload {
  externalId: string;
  onecNumber: string;
  onecDate: string;
  warehouse: {
    code: string;
    name: string;
  };
  items: Array<{
    sku: string;
    name: string;
    unit: string;
    qtyFrom1C: string;
    barcodes: string[];
  }>;
}

export interface UpdateItemsPayload {
  version: number;
  items: Array<{
    sku?: string;
    barcode?: string;
    countedQty?: string;
    correctedQty?: string;
    note?: string;
  }>;
}

export interface ApiError {
  code: string;
  message: string;
}

export class InventoryService {
  static async importFrom1C(payload: ImportPayload) {
    return await prisma.$transaction(async (tx) => {
      // 1. Upsert warehouse
      const warehouse = await tx.warehouse.upsert({
        where: { code: payload.warehouse.code },
        create: {
          code: payload.warehouse.code,
          name: payload.warehouse.name,
        },
        update: {
          name: payload.warehouse.name,
        },
      });

      // 2. Upsert document
      const document = await tx.inventoryDocument.upsert({
        where: { externalId: payload.externalId },
        create: {
          externalId: payload.externalId,
          onecNumber: payload.onecNumber,
          onecDate: new Date(payload.onecDate),
          warehouseId: warehouse.id,
          warehouseCode: warehouse.code,
          status: 'IMPORTED',
          version: 1,
        },
        update: {
          onecNumber: payload.onecNumber,
          onecDate: new Date(payload.onecDate),
          warehouseCode: warehouse.code,
          // version не изменяем при повторном импорте
        },
      });

      // 3. Process items
      for (const itemData of payload.items) {
        const item = await tx.inventoryItem.upsert({
          where: {
            documentId_sku: {
              documentId: document.id,
              sku: itemData.sku,
            },
          },
          create: {
            documentId: document.id,
            sku: itemData.sku,
            name: itemData.name,
            unit: itemData.unit,
            qtyFrom1C: new Prisma.Decimal(itemData.qtyFrom1C),
          },
          update: {
            name: itemData.name,
            unit: itemData.unit,
            qtyFrom1C: new Prisma.Decimal(itemData.qtyFrom1C),
          },
        });

        // 4. Process barcodes
        for (let i = 0; i < itemData.barcodes.length; i++) {
          const barcode = itemData.barcodes[i];
          const isPrimary = i === 0;

          await tx.inventoryItemBarcode.upsert({
            where: {
              documentId_barcode: {
                documentId: document.id,
                barcode: barcode,
              },
            },
            create: {
              documentId: document.id,
              itemId: item.id,
              barcode: barcode,
              isPrimary: isPrimary,
            },
            update: {
              itemId: item.id,
              isPrimary: isPrimary,
            },
          });
        }
      }

      // Return full document with items and barcodes
      return await tx.inventoryDocument.findUnique({
        where: { id: document.id },
        include: {
          warehouse: true,
          items: {
            include: {
              barcodes: true,
            },
          },
        },
      });
    });
  }

  static async getDocument(id: string) {
    const document = await prisma.inventoryDocument.findUnique({
      where: { id },
      include: {
        warehouse: true,
        items: {
          include: {
            barcodes: true,
          },
        },
      },
    });

    if (!document) {
      throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
    }

    return document;
  }

  static async getDocumentsByWarehouse(warehouseCode: string) {
    const documents = await prisma.inventoryDocument.findMany({
      where: { warehouseCode },
      include: {
        warehouse: true,
        items: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            qtyFrom1C: true,
            countedQty: true,
            correctedQty: true,
            deltaQty: true,
            note: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return documents;
  }

  static async updateItems(id: string, payload: UpdateItemsPayload) {
    return await prisma.$transaction(async (tx) => {
      // 1. Check document exists and version
      const document = await tx.inventoryDocument.findUnique({
        where: { id },
      });

      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
      }

      if (document.version !== payload.version) {
        throw {
          code: 'CONFLICT',
          message: `Version mismatch. Expected ${document.version}, got ${payload.version}`,
        } as ApiError;
      }

      // 2. Process each item update
      for (const itemUpdate of payload.items) {
        let itemId: string;

        if (itemUpdate.sku) {
          // Find by SKU
          const item = await tx.inventoryItem.findUnique({
            where: {
              documentId_sku: {
                documentId: id,
                sku: itemUpdate.sku,
              },
            },
          });

          if (!item) {
            throw {
              code: 'NOT_FOUND',
              message: `Item with SKU ${itemUpdate.sku} not found`,
            } as ApiError;
          }

          itemId = item.id;
        } else if (itemUpdate.barcode) {
          // Find by barcode
          const barcode = await tx.inventoryItemBarcode.findUnique({
            where: {
              documentId_barcode: {
                documentId: id,
                barcode: itemUpdate.barcode,
              },
            },
          });

          if (!barcode) {
            throw {
              code: 'NOT_FOUND',
              message: `Barcode ${itemUpdate.barcode} not found`,
            } as ApiError;
          }

          itemId = barcode.itemId;
        } else {
          throw {
            code: 'BAD_REQUEST',
            message: 'Either sku or barcode must be provided',
          } as ApiError;
        }

        // 3. Update item
        const updateData: any = {};
        if (itemUpdate.countedQty !== undefined) {
          updateData.countedQty = new Prisma.Decimal(itemUpdate.countedQty);
        }
        if (itemUpdate.correctedQty !== undefined) {
          updateData.correctedQty = new Prisma.Decimal(itemUpdate.correctedQty);
        }
        if (itemUpdate.note !== undefined) {
          updateData.note = itemUpdate.note;
        }

        await tx.inventoryItem.update({
          where: { id: itemId },
          data: updateData,
        });
      }

      // 4. Increment document version
      const updatedDocument = await tx.inventoryDocument.update({
        where: { id },
        data: { version: { increment: 1 } },
        include: {
          warehouse: true,
          items: {
            include: {
              barcodes: true,
            },
          },
        },
      });

      return updatedDocument;
    });
  }

  static async revise(id: string) {
    return await prisma.$transaction(async (tx) => {
      // 1. Check document exists and status
      const document = await tx.inventoryDocument.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
      }

      if (document.status !== 'IMPORTED') {
        throw {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Document must be in IMPORTED status',
        } as ApiError;
      }

      // 2. Calculate deltas for each item
      for (const item of document.items) {
        const effective = item.correctedQty || item.countedQty;
        let deltaQty: Prisma.Decimal | null = null;

        if (effective) {
          deltaQty = effective.sub(item.qtyFrom1C);
        }

        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { deltaQty },
        });
      }

      // 3. Update document status and version
      const updatedDocument = await tx.inventoryDocument.update({
        where: { id },
        data: {
          status: 'REVISED',
          version: { increment: 1 },
        },
      });

      return {
        id: updatedDocument.id,
        status: updatedDocument.status,
        version: updatedDocument.version,
      };
    });
  }

  static async exportFor1C(id: string) {
    const document = await prisma.inventoryDocument.findUnique({
      where: { id },
      include: {
        warehouse: true,
        items: {
          include: {
            barcodes: true,
          },
        },
      },
    });

    if (!document) {
      throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
    }

    if (document.status !== 'REVISED') {
      throw {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Document must be in REVISED status',
      } as ApiError;
    }

    const exportData = {
      externalId: document.externalId,
      warehouse: {
        code: document.warehouse.code,
      },
      items: document.items.map((item) => ({
        sku: item.sku,
        unit: item.unit,
        correctedQty: (item.correctedQty || item.countedQty)?.toString() || '0',
        deltaQty: item.deltaQty?.toString() || '0',
        barcodes: item.barcodes.map((b) => b.barcode),
      })),
    };

    return exportData;
  }

  static async ack(id: string) {
    return await prisma.$transaction(async (tx) => {
      const document = await tx.inventoryDocument.findUnique({
        where: { id },
      });

      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
      }

      if (document.status !== 'REVISED' && document.status !== 'EXPORTED') {
        throw {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Document must be in REVISED or EXPORTED status',
        } as ApiError;
      }

      // Set to EXPORTED (idempotent)
      await tx.inventoryDocument.update({
        where: { id },
        data: { status: 'EXPORTED' },
      });

      return { success: true };
    });
  }
}
