import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

export interface UpdateItemsPayloadV2 {
  version: number;
  deviceId?: string; // Идентификатор ТСД
  items: Array<{
    sku?: string;
    barcode?: string;
    countedQty?: string;
    correctedQty?: string;
    note?: string;
    lastKnownModified?: string; // Timestamp последнего известного изменения
  }>;
}

export interface UpdateResult {
  success: boolean;
  version: number;
  conflicts: Array<{
    sku: string;
    field: string;
    yourValue: string;
    currentValue: string;
    lastModified: string;
    modifiedBy?: string;
  }>;
  appliedChanges: number;
}

export class InventoryServiceV2 {
  // Универсальное разрешение документа по ключу: id | externalId | onecNumber
  private static async resolveDocumentId(db: any, key: string): Promise<string | null> {
    // 1) Пытаемся как внутренний id
    let doc = await db.inventoryDocument.findUnique({ where: { id: key } });
    if (doc) return doc.id;

    // 2) Пытаемся как externalId (предполагается уникальность)
    try {
      doc = await db.inventoryDocument.findUnique({ where: { externalId: key } });
      if (doc) return doc.id;
    } catch (_) {
      // ignore if not unique in schema
    }

    // 3) Пытаемся как onecNumber (может быть не уникальным) — берём самый свежий
    doc = await db.inventoryDocument.findFirst({
      where: { onecNumber: key },
      orderBy: { createdAt: 'desc' },
    });
    return doc ? doc.id : null;
  }

  static async updateItemsWithMerge(id: string, payload: UpdateItemsPayloadV2): Promise<UpdateResult> {
    return await prisma.$transaction(async (tx) => {
      // 1. Разрешаем идентификатор (id | externalId | onecNumber) -> внутренний id
      const resolvedId = await InventoryServiceV2.resolveDocumentId(tx, id);
      if (!resolvedId) {
        throw { code: 'NOT_FOUND', message: 'Document not found' };
      }

      // 2. Проверяем версию документа
      const document = await tx.inventoryDocument.findUnique({
        where: { id: resolvedId },
        include: { items: true },
      });

      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' };
      }

      if (document.version !== payload.version) {
        throw {
          code: 'CONFLICT',
          message: `Document version mismatch. Expected ${document.version}, got ${payload.version}`,
        };
      }

      const conflicts: UpdateResult['conflicts'] = [];
      let appliedChanges = 0;

      // 2. Обрабатываем каждое изменение
      for (const itemUpdate of payload.items) {
        let targetItem: any;

        // Находим целевую строку
        if (itemUpdate.sku) {
          targetItem = document.items.find(item => item.sku === itemUpdate.sku);
  } else if (itemUpdate.barcode) {
          const barcode = await tx.inventoryItemBarcode.findUnique({
            where: {
              documentId_barcode: {
    documentId: document.id,
                barcode: itemUpdate.barcode,
              },
            },
          });
          if (barcode) {
            targetItem = document.items.find(item => item.id === barcode.itemId);
          }
        }

        if (!targetItem) {
          continue; // Пропускаем несуществующие строки
        }

        // 3. Проверяем конфликты по timestamp
        const lastKnownModified = itemUpdate.lastKnownModified 
          ? new Date(itemUpdate.lastKnownModified)
          : null;

        const currentModified = targetItem.updatedAt;
        const hasConflict = lastKnownModified && 
          currentModified > lastKnownModified;

        if (hasConflict) {
          // Записываем конфликт, но можем все равно применить изменение
          if (itemUpdate.countedQty !== undefined) {
            conflicts.push({
              sku: targetItem.sku,
              field: 'countedQty',
              yourValue: itemUpdate.countedQty,
              currentValue: targetItem.countedQty?.toString() || '',
              lastModified: currentModified.toISOString(),
              modifiedBy: targetItem.note || undefined,
            });
          }

          if (itemUpdate.correctedQty !== undefined) {
            conflicts.push({
              sku: targetItem.sku,
              field: 'correctedQty',
              yourValue: itemUpdate.correctedQty,
              currentValue: targetItem.correctedQty?.toString() || '',
              lastModified: currentModified.toISOString(),
              modifiedBy: targetItem.note || undefined,
            });
          }
        }

        // 4. Применяем изменения (стратегия "последний побеждает")
        const updateData: any = {};
        let hasUpdates = false;

        if (itemUpdate.countedQty !== undefined) {
          updateData.countedQty = new Prisma.Decimal(itemUpdate.countedQty);
          hasUpdates = true;
        }
        
        if (itemUpdate.correctedQty !== undefined) {
          updateData.correctedQty = new Prisma.Decimal(itemUpdate.correctedQty);
          hasUpdates = true;
        }
        
        if (itemUpdate.note !== undefined) {
          updateData.note = itemUpdate.note;
          hasUpdates = true;
        }

        if (hasUpdates) {
          await tx.inventoryItem.update({
            where: { id: targetItem.id },
            data: updateData,
          });
          appliedChanges++;
        }
      }

      // 5. Обновляем версию документа
      const updatedDocument = await tx.inventoryDocument.update({
        where: { id: document.id },
        data: { version: { increment: 1 } },
      });

      return {
        success: true,
        version: updatedDocument.version,
        conflicts,
        appliedChanges,
      };
    }, {
      maxWait: 10000,
      timeout: 15000,
    });
  }

  // Метод для получения изменений с timestamp
  static async getDocumentWithTimestamps(id: string) {
    const resolvedId = await InventoryServiceV2.resolveDocumentId(prisma, id);
    if (!resolvedId) {
      throw { code: 'NOT_FOUND', message: 'Document not found' };
    }

    const document = await prisma.inventoryDocument.findUnique({
      where: { id: resolvedId },
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
      throw { code: 'NOT_FOUND', message: 'Document not found' };
    }

    // Добавляем timestamp для каждой строки
    const documentWithTimestamps = {
      ...document,
      items: document.items.map(item => ({
        ...item,
        lastModified: item.updatedAt.toISOString(),
      })),
    };

    return documentWithTimestamps;
  }
}
