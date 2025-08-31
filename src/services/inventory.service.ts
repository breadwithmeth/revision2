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
  deviceId?: string;
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
  // Вспомогательная функция: разрешение id | externalId | onecNumber -> внутренний id
  private static async resolveDocumentId(db: any, key: string): Promise<string | null> {
    let d = await db.inventoryDocument.findUnique({ where: { id: key } });
    if (d) return d.id;
    try {
      d = await db.inventoryDocument.findUnique({ where: { externalId: key } });
      if (d) return d.id;
    } catch (_) {
      // ignore if externalId is not unique in schema
    }
    d = await db.inventoryDocument.findFirst({ where: { onecNumber: key }, orderBy: { createdAt: 'desc' } });
    return d ? d.id : null;
  }

  static async importFrom1C(payload: ImportPayload) {
    const startTime = Date.now();
    const res = await prisma.$transaction(async (tx) => {
      // 1) Склад
      const warehouse = await tx.warehouse.upsert({
        where: { code: payload.warehouse.code },
        create: { code: payload.warehouse.code, name: payload.warehouse.name },
        update: { name: payload.warehouse.name },
      });

      // 2) Документ
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
        },
      });

      // 3) Позиции и штрихкоды
      for (const item of payload.items) {
        const existing = await tx.inventoryItem.findUnique({
          where: { documentId_sku: { documentId: document.id, sku: item.sku } },
        });

        let itemId: string;
        if (existing) {
          const updated = await tx.inventoryItem.update({
            where: { id: existing.id },
            data: {
              name: item.name,
              unit: item.unit,
              qtyFrom1C: new Prisma.Decimal(item.qtyFrom1C),
            },
          });
          itemId = updated.id;
        } else {
          const created = await tx.inventoryItem.create({
            data: {
              documentId: document.id,
              sku: item.sku,
              name: item.name,
              unit: item.unit,
              qtyFrom1C: new Prisma.Decimal(item.qtyFrom1C),
            },
          });
          itemId = created.id;
        }

        // Пересоздаём штрихкоды для строки
        await tx.inventoryItemBarcode.deleteMany({ where: { itemId } });
        if (item.barcodes.length > 0) {
          const toCreate = item.barcodes.map((b, idx) => ({
            documentId: document.id,
            itemId,
            barcode: b,
            isPrimary: idx === 0,
          }));
          await tx.inventoryItemBarcode.createMany({ data: toCreate, skipDuplicates: true });
        }
      }

      const result = await tx.inventoryDocument.findUnique({
        where: { id: document.id },
        include: { warehouse: true, items: { include: { barcodes: true } } },
      });
      return result!;
    }, { maxWait: 10000, timeout: 30000 });

    const took = Date.now() - startTime;
    console.log(`Import of ${payload.externalId} completed in ${took} ms`);
    return res;
  }

  static async getDocument(id: string) {
    const resolvedId = await InventoryService.resolveDocumentId(prisma, id);
    if (!resolvedId) throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
    const document = await prisma.inventoryDocument.findUnique({
      where: { id: resolvedId },
      include: { warehouse: true, items: { include: { barcodes: true } } },
    });
    if (!document) throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
    return document;
  }

  static async listWarehouses() {
    const warehouses = await prisma.warehouse.findMany({ orderBy: { code: 'asc' } });
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
      orderBy: { createdAt: 'desc' },
    });
    return documents;
  }

  static async updateItems(id: string, payload: UpdateItemsPayload) {
    return await prisma.$transaction(async (tx) => {
      const document = await tx.inventoryDocument.findUnique({ where: { id } });
      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
      }
      if (document.version !== payload.version) {
        throw { code: 'CONFLICT', message: `Version mismatch. Expected ${document.version}, got ${payload.version}` } as ApiError;
      }

      for (const itemUpdate of payload.items) {
        let itemId: string;
        let currentItem: any | null = null;

        if (itemUpdate.sku) {
          const item = await tx.inventoryItem.findUnique({
            where: { documentId_sku: { documentId: id, sku: itemUpdate.sku } },
          });
          if (!item) {
            throw { code: 'NOT_FOUND', message: `Item with SKU ${itemUpdate.sku} not found` } as ApiError;
          }
          itemId = item.id;
          currentItem = item;
        } else if (itemUpdate.barcode) {
          const barcode = await tx.inventoryItemBarcode.findUnique({
            where: { documentId_barcode: { documentId: id, barcode: itemUpdate.barcode } },
          });
          if (!barcode) {
            throw { code: 'NOT_FOUND', message: `Barcode ${itemUpdate.barcode} not found` } as ApiError;
          }
          itemId = barcode.itemId;
          currentItem = await tx.inventoryItem.findUnique({ where: { id: itemId } });
        } else {
          throw { code: 'BAD_REQUEST', message: 'Either sku or barcode must be provided' } as ApiError;
        }

        const updateData: any = {};
        let newCounted: Prisma.Decimal | undefined;
        let newCorrected: Prisma.Decimal | undefined;
        if (itemUpdate.countedQty !== undefined) {
          const base = currentItem?.countedQty ?? new Prisma.Decimal(0);
          const add = new Prisma.Decimal(itemUpdate.countedQty);
          newCounted = (base as Prisma.Decimal).add(add);
          updateData.countedQty = newCounted;
        }
        if (itemUpdate.correctedQty !== undefined) {
          const base = currentItem?.correctedQty ?? new Prisma.Decimal(0);
          const add = new Prisma.Decimal(itemUpdate.correctedQty);
          newCorrected = (base as Prisma.Decimal).add(add);
          updateData.correctedQty = newCorrected;
        }
        if (itemUpdate.note !== undefined) {
          updateData.note = itemUpdate.note;
        }

        await tx.inventoryItem.update({ where: { id: itemId }, data: updateData });

    if (itemUpdate.countedQty !== undefined || itemUpdate.correctedQty !== undefined || itemUpdate.note !== undefined) {
          await (tx as any).inventoryItemChange.create({
            data: {
              documentId: id,
              itemId,
              deviceId: payload.deviceId || 'unknown',
      countedQty: newCounted ?? null,
      correctedQty: newCorrected ?? null,
              note: itemUpdate.note,
            },
          });
        }
      }

      const updatedDocument = await tx.inventoryDocument.update({
        where: { id },
        data: { version: { increment: 1 } },
        include: { warehouse: true, items: { include: { barcodes: true } } },
      });
      return updatedDocument;
    }, { maxWait: 10000, timeout: 15000 });
  }

  static async revise(id: string) {
    return await prisma.$transaction(async (tx) => {
      const document = await tx.inventoryDocument.findUnique({ where: { id }, include: { items: true } });
      if (!document) {
        throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;
      }

      for (const item of document.items) {
        const counted = item.countedQty ?? new Prisma.Decimal(0);
        const correctedBase = item.correctedQty ?? counted;
        const delta = (correctedBase as Prisma.Decimal).sub(item.qtyFrom1C);
        await tx.inventoryItem.update({ where: { id: item.id }, data: { deltaQty: delta } });
      }

      const updated = await tx.inventoryDocument.update({
        where: { id: document.id },
        data: { status: 'REVISED', version: { increment: 1 } },
      });
      return { success: true, status: updated.status, version: updated.version };
    }, { maxWait: 10000, timeout: 15000 });
  }

  static async exportFor1C(id: string) {
    // Разрешаем id | externalId | onecNumber
    const resolvedId = await InventoryService.resolveDocumentId(prisma, id);
    if (!resolvedId) throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;

    const document = await prisma.inventoryDocument.findUnique({
      where: { id: resolvedId },
      include: { warehouse: true, items: { include: { barcodes: true } } },
    });
    if (!document) throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;

    // Берём последние зафиксированные количества из таблицы InventoryItemChange
      // Берём последние значения по deviceId и складываем их
      const changes: Array<{ itemId: string; countedQty: Prisma.Decimal | null; correctedQty: Prisma.Decimal | null; createdAt: Date; deviceId: string }>
        = await (prisma as any).inventoryItemChange.findMany({
          where: { documentId: document.id },
          select: { itemId: true, countedQty: true, correctedQty: true, createdAt: true, deviceId: true },
          orderBy: { createdAt: 'asc' },
        });

      // Для каждой строки: deviceId -> последнее изменение (по времени)
      const latestByDevice = new Map<string, Map<string, { counted: Prisma.Decimal; corrected: Prisma.Decimal }>>();
      // Группируем по itemId и deviceId
      const grouped = new Map<string, Map<string, Array<{ counted: Prisma.Decimal; corrected: Prisma.Decimal; createdAt: Date }>>>();
      for (const ch of changes) {
        if (!grouped.has(ch.itemId)) grouped.set(ch.itemId, new Map());
        const devMap = grouped.get(ch.itemId)!;
        if (!devMap.has(ch.deviceId)) devMap.set(ch.deviceId, []);
        devMap.get(ch.deviceId)!.push({
          counted: ch.countedQty ?? new Prisma.Decimal(0),
          corrected: ch.correctedQty ?? new Prisma.Decimal(0),
          createdAt: ch.createdAt,
        });
      }
      // Для каждой itemId и deviceId выбираем самое позднее изменение
      for (const [itemId, devMap] of grouped.entries()) {
        latestByDevice.set(itemId, new Map());
        for (const [deviceId, arr] of devMap.entries()) {
          if (arr.length === 0) continue;
          // Находим с максимальным createdAt
          let latest = arr[0];
          for (const rec of arr) {
            if (rec.createdAt > latest.createdAt) latest = rec;
          }
          latestByDevice.get(itemId)!.set(deviceId, {
            counted: latest.counted,
            corrected: latest.corrected,
          });
        }
      }

    return {
      externalId: document.externalId,
      warehouse: { code: document.warehouse.code },
      items: document.items.map((item) => {
        const devMap = latestByDevice.get(item.id) || new Map();
        // Складываем только последние значения по каждому deviceId
        let countedSum = new Prisma.Decimal(0);
        let correctedSum = new Prisma.Decimal(0);
        for (const v of devMap.values()) {
          countedSum = countedSum.add(v.counted);
          correctedSum = correctedSum.add(v.corrected);
        }
        // Если нет изменений — fallback к значениям из строки
        if (devMap.size === 0) {
          countedSum = item.countedQty ?? new Prisma.Decimal(0);
          correctedSum = item.correctedQty ?? countedSum;
        }
        const deltaFinal = correctedSum.sub(item.qtyFrom1C);
        return {
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          correctedQty: correctedSum.toString(),
          countedQty: countedSum.toString(),
          deltaQty: deltaFinal.toString(),
          barcodes: item.barcodes.map((b) => b.barcode),
        };
      }),
    };
  }

  static async ack(id: string) {
    return await prisma.$transaction(async (tx) => {
      const resolvedId = await InventoryService.resolveDocumentId(tx, id);
      if (!resolvedId) throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;

      const document = await tx.inventoryDocument.findUnique({ where: { id: resolvedId } });
      if (!document) throw { code: 'NOT_FOUND', message: 'Document not found' } as ApiError;

      if (document.status !== 'REVISED' && document.status !== 'EXPORTED') {
        throw { code: 'UNPROCESSABLE_ENTITY', message: 'Document must be in REVISED or EXPORTED status' } as ApiError;
      }

      await tx.inventoryDocument.update({ where: { id: document.id }, data: { status: 'EXPORTED' } });
      return { success: true };
    }, { maxWait: 5000, timeout: 10000 });
  }
}
