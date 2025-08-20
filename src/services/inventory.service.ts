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
    const startTime = Date.now();
    console.log(`Starting import for document ${payload.externalId} with ${payload.items.length} items`);
    
    try {
      const result = await prisma.$transaction(async (tx) => {
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

        // 3. Batch process items - сначала все items
        const itemsToCreate = [];
        const itemsToUpdate = [];

        for (const itemData of payload.items) {
          const existingItem = await tx.inventoryItem.findUnique({
            where: {
              documentId_sku: {
                documentId: document.id,
                sku: itemData.sku,
              },
            },
          });

          if (existingItem) {
            itemsToUpdate.push({
              where: { id: existingItem.id },
              data: {
                name: itemData.name,
                unit: itemData.unit,
                qtyFrom1C: new Prisma.Decimal(itemData.qtyFrom1C),
              },
            });
          } else {
            itemsToCreate.push({
              documentId: document.id,
              sku: itemData.sku,
              name: itemData.name,
              unit: itemData.unit,
              qtyFrom1C: new Prisma.Decimal(itemData.qtyFrom1C),
            });
          }
        }

        // Batch create new items
        if (itemsToCreate.length > 0) {
          await tx.inventoryItem.createMany({
            data: itemsToCreate,
            skipDuplicates: true,
          });
        }

        // Update existing items
        for (const update of itemsToUpdate) {
          await tx.inventoryItem.update(update);
        }

        // 4. Process barcodes - получаем все items снова для получения ID
        const allItems = await tx.inventoryItem.findMany({
          where: { documentId: document.id },
        });

        const barcodesToCreate = [];
        
        for (const itemData of payload.items) {
          const item = allItems.find(i => i.sku === itemData.sku);
          if (!item) continue;

          // Удаляем старые штрихкоды этого товара
          await tx.inventoryItemBarcode.deleteMany({
            where: {
              documentId: document.id,
              itemId: item.id,
            },
          });

          // Подготавливаем новые штрихкоды
          for (let i = 0; i < itemData.barcodes.length; i++) {
            const barcode = itemData.barcodes[i];
            const isPrimary = i === 0;

            barcodesToCreate.push({
              documentId: document.id,
              itemId: item.id,
              barcode: barcode,
              isPrimary: isPrimary,
            });
          }
        }

        // Batch create barcodes
        if (barcodesToCreate.length > 0) {
          await tx.inventoryItemBarcode.createMany({
            data: barcodesToCreate,
            skipDuplicates: true,
          });
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
      }, {
        maxWait: 20000, // максимальное время ожидания (20 сек)
        timeout: 30000, // максимальное время выполнения (30 сек)
      });
      
      const endTime = Date.now();
      console.log(`Import completed for document ${payload.externalId} in ${endTime - startTime}ms`);
      return result;
    } catch (error) {
      const endTime = Date.now();
      console.error(`Import failed for document ${payload.externalId} after ${endTime - startTime}ms:`, error);
      throw error;
    }
  }  static async getDocument(id: string) {
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

  static async listWarehouses() {
    const warehouses = await prisma.warehouse.findMany({
      orderBy: [{ code: 'asc' }],
    });
    return warehouses;
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
    }, {
      maxWait: 10000,
      timeout: 15000,
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
    }, {
      maxWait: 10000,
      timeout: 15000,
    });
  }

  static async exportFor1C(id: string) {
    const document = await prisma.inventoryDocument.findFirst({
      where: { onecNumber: id },
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

    // Убираем проверку статуса - можно экспортировать в любом статусе

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
    }, {
      maxWait: 5000,
      timeout: 10000,
    });
  }
}
