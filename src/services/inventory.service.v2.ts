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

      // 2. Оптимистическая блокировка: атомарно инкрементируем версию, если она совпадает с переданной
    //   const bump = await tx.inventoryDocument.updateMany({
    //     where: { id: resolvedId, version: payload.version },
    //     data: { version: { increment: 1 } },
    //   });
    //   if (bump.count === 0) {
    //     const current = await tx.inventoryDocument.findUnique({
    //       where: { id: resolvedId },
    //       select: { version: true },
    //     });
    //     throw {
    //       code: 'CONFLICT',
    //       message: `Document version mismatch. Current ${current?.version}, provided ${payload.version}`,
    //     };
    //   }

      // Загружаем документ после успешного bump
      const document = await tx.inventoryDocument.findUnique({
        where: { id: resolvedId },
        include: { items: true },
      });
      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' };
      }

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

    // Конфликты не обрабатываем

        // 4. Применяем изменения (стратегия "последний побеждает")
        const updateData: any = {};
        let newCounted: Prisma.Decimal | undefined;
        let newCorrected: Prisma.Decimal | undefined;
        let hasUpdates = false;

        if (itemUpdate.countedQty !== undefined) {
          newCounted = new Prisma.Decimal(itemUpdate.countedQty);
          hasUpdates = true;
        }

        if (itemUpdate.correctedQty !== undefined) {
          newCorrected = new Prisma.Decimal(itemUpdate.correctedQty);
          hasUpdates = true;
        }
        
        if (itemUpdate.note !== undefined) {
          updateData.note = itemUpdate.note;
          hasUpdates = true;
        }

        if (hasUpdates) {
          // Только логируем изменения устройства, inventoryItem не обновляем
          await (tx as any).inventoryItemChange.create({
            data: {
              documentId: document.id,
              itemId: targetItem.id,
              deviceId: payload.deviceId || 'unknown',
              countedQty: newCounted ?? null,
              correctedQty: newCorrected ?? null,
              note: itemUpdate.note,
            },
          });
          appliedChanges++;
        }
      }

      return {
        success: true,
        version: document.version,
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
