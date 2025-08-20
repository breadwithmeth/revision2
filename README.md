# REST-бэкенд "Пересчёт товаров"

REST API для управления документами пересчёта товаров с интеграцией 1С. Построен на TypeScript + Fastify + Prisma + MySQL.

## Установка и запуск

### 1. Установите зависимости

```bash
npm install
```

### 2. Настройте базу данных

Скопируйте `.env.example` в `.env` и настройте подключение к MySQL:

```bash
cp .env.example .env
```

Отредактируйте `.env`:
```
DATABASE_URL="mysql://username:password@localhost:3306/revision"
PORT=3000
```

### 3. Запустите миграции Prisma

```bash
npm run prisma:migrate
```

### 4. Запустите сервер

Для разработки:
```bash
npm run dev
```

Для продакшена:
```bash
npm run build
npm start
```

## API Эндпоинты

### 1. Импорт документа из 1С

**POST** `/onec/inventory-documents/import`

Идемпотентная операция импорта документа пересчёта из 1С.

```json
{
  "externalId": "2c4b1f2a-3456-7890-abcd-123456789e91",
  "onecNumber": "ПР-000123",
  "onecDate": "2025-08-20T10:00:00Z",
  "warehouse": {
    "code": "MAIN",
    "name": "Главный склад"
  },
  "items": [
    {
      "sku": "A123",
      "name": "Шуруп 3x20",
      "unit": "шт",
      "qtyFrom1C": "10",
      "barcodes": ["4601234567890", "2000000012345"]
    },
    {
      "sku": "B456",
      "name": "Краска белая",
      "unit": "л",
      "qtyFrom1C": "5",
      "barcodes": ["4698765432109"]
    }
  ]
}
```

**Ответ:** Полный документ со всеми строками и штрихкодами.

### 2. Получение документа

**GET** `/inventory-documents/:id`

Возвращает полный документ со всеми строками и штрихкодами для ТСД.

### 2.1. Получение списка документов по складу

**GET** `/inventory-documents/warehouse/:warehouseCode`

Возвращает список всех документов для указанного склада, отсортированных по дате создания (новые первыми).

**Пример запроса:**
```bash
curl http://localhost:3000/inventory-documents/warehouse/MAIN
```

**Ответ:** Массив документов с основной информацией о строках (без штрихкодов для оптимизации).

### 3. Массовое обновление строк документа

**PATCH** `/inventory-documents/:id/items`

Обновление данных пересчёта из ТСД с optimistic locking.

```json
{
  "version": 1,
  "items": [
    {
      "sku": "A123",
      "countedQty": "12.5",
      "note": "пересчет"
    },
    {
      "barcode": "4698765432109",
      "countedQty": "4.0"
    },
    {
      "sku": "B456",
      "correctedQty": "4.0"
    }
  ]
}
```

**Правила:**
- Элемент адресуется либо по `sku`, либо по `barcode`
- Разрешённые поля для обновления: `countedQty`, `correctedQty`, `note`
- При несовпадении версии возвращается 409 Conflict

### 3.1. Улучшенное обновление с разрешением конфликтов

**PATCH** `/inventory-documents/:id/items/v2`

Новая версия API с поддержкой автоматического разрешения конфликтов при одновременной работе нескольких ТСД.

```json
{
  "version": 1,
  "deviceId": "TSD-001",
  "items": [
    {
      "sku": "A123",
      "countedQty": "12.5",
      "note": "пересчет",
      "lastKnownModified": "2025-08-20T10:30:00Z"
    }
  ]
}
```

**Ответ при конфликтах (206 Partial Content):**
```json
{
  "success": true,
  "version": 2,
  "appliedChanges": 1,
  "conflicts": [
    {
      "sku": "A123",
      "field": "countedQty", 
      "yourValue": "12.5",
      "currentValue": "13.0",
      "lastModified": "2025-08-20T10:35:00Z",
      "modifiedBy": "TSD-002"
    }
  ]
}
```

**GET** `/inventory-documents/:id/with-timestamps`

Получение документа с временными метками для отслеживания изменений.

### 4. Расчёт дельт и фиксация

**POST** `/inventory-documents/:id/revise`

Переводит документ из статуса IMPORTED в REVISED, рассчитывая дельты.

**Формула:** `deltaQty = (correctedQty ?? countedQty) - qtyFrom1C`

**Ответ:**
```json
{
  "id": "doc_id",
  "status": "REVISED",
  "version": 2
}
```

### 5. Экспорт для 1С

**GET** `/onec/inventory-documents/:id/export`

Возвращает данные для экспорта в 1С (только после revise).

**Ответ:**
```json
{
  "externalId": "2c4b1f2a-3456-7890-abcd-123456789e91",
  "warehouse": {
    "code": "MAIN"
  },
  "items": [
    {
      "sku": "A123",
      "unit": "шт",
      "correctedQty": "12.5",
      "deltaQty": "2.5",
      "barcodes": ["4601234567890", "2000000012345"]
    },
    {
      "sku": "B456", 
      "unit": "л",
      "correctedQty": "4.0",
      "deltaQty": "-1.0",
      "barcodes": ["4698765432109"]
    }
  ]
}
```

### 6. Подтверждение от 1С

**POST** `/onec/inventory-documents/:id/ack`

Подтверждает получение данных 1С, переводит документ в статус EXPORTED.

## Коды ошибок

Все ошибки возвращаются в едином формате:

```json
{
  "code": "ERROR_CODE",
  "message": "Описание ошибки"
}
```

- `400 BAD_REQUEST` — невалидные поля/числа/формат
- `404 NOT_FOUND` — документ/строка/штрихкод не найдены
- `409 CONFLICT` — version не совпал (optimistic locking)
- `422 UNPROCESSABLE_ENTITY` — неправильный переход статуса

## Статусы документа

- **IMPORTED** — импортирован из 1С, можно редактировать
- **REVISED** — зафиксирован, дельты рассчитаны, готов к экспорту
- **EXPORTED** — данные переданы в 1С

## Примеры использования

### Полный цикл работы с документом

```bash
# 1. Импорт из 1С
curl -X POST http://localhost:3000/onec/inventory-documents/import \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "test-doc-001",
    "onecNumber": "ПР-000001",
    "onecDate": "2025-08-20T10:00:00Z",
    "warehouse": {"code": "MAIN", "name": "Главный склад"},
    "items": [
      {
        "sku": "ITEM001",
        "name": "Тестовый товар",
        "unit": "шт",
        "qtyFrom1C": "100",
        "barcodes": ["1234567890123"]
      }
    ]
  }'

# 2. Получение документа (используйте ID из ответа предыдущего запроса)
curl http://localhost:3000/inventory-documents/{DOCUMENT_ID}

# 3. Обновление данных пересчёта
curl -X PATCH http://localhost:3000/inventory-documents/{DOCUMENT_ID}/items \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "items": [
      {
        "sku": "ITEM001",
        "countedQty": "95",
        "note": "недостача 5 шт"
      }
    ]
  }'

# 4. Фиксация документа
curl -X POST http://localhost:3000/inventory-documents/{DOCUMENT_ID}/revise

# 5. Экспорт для 1С
curl http://localhost:3000/onec/inventory-documents/{DOCUMENT_ID}/export

# 6. Подтверждение от 1С
curl -X POST http://localhost:3000/onec/inventory-documents/{DOCUMENT_ID}/ack
```

## Структура проекта

```
├── prisma/
│   └── schema.prisma          # Схема базы данных
├── src/
│   ├── index.ts              # Точка входа, настройка Fastify
│   ├── prisma.ts             # Подключение к Prisma
│   ├── routes/               # HTTP роуты
│   │   ├── onec.import.ts    # Импорт из 1С
│   │   ├── inventory.get.ts  # Получение документа
│   │   ├── inventory.items.ts # Обновление строк
│   │   ├── inventory.revise.ts # Фиксация документа
│   │   ├── onec.export.ts    # Экспорт для 1С
│   │   └── onec.ack.ts       # Подтверждение от 1С
│   └── services/
│       └── inventory.service.ts # Бизнес-логика
├── package.json
├── tsconfig.json
├── .env                      # Конфигурация (не в git)
└── .env.example              # Пример конфигурации
```

## Одновременная работа нескольких ТСД

Система поддерживает работу нескольких ТСД одновременно:

### Базовый режим (API v1)
- **Optimistic locking** на уровне документа
- При конфликте версий возвращается 409 Conflict
- Пользователь должен перечитать документ и повторить операцию

### Улучшенный режим (API v2) 
- **Smart merge** - автоматическое слияние несконфликтующих изменений
- **Conflict detection** - отслеживание изменений на уровне строк
- **Last Writer Wins** - при конфликте побеждает последнее изменение
- Возврат детальной информации о конфликтах

**Пример работы:**
1. ТСД-1 редактирует товар A → ✅ успешно
2. ТСД-2 редактирует товар B → ✅ успешно  
3. ТСД-3 редактирует товар A → ⚠️ конфликт, но изменение применено

Подробнее см. [CONCURRENT_ACCESS.md](./CONCURRENT_ACCESS.md)

## Технические особенности

- **Транзакции:** Все операции записи выполняются в `prisma.$transaction`
- **Timeout защита:** Настроены увеличенные timeout для длительных операций
  - Импорт: 30 секунд (для больших документов)
  - Обновления: 15 секунд
  - Простые операции: 10 секунд
- **Batch операции:** Оптимизированный импорт с использованием `createMany`
- **Количества:** Храним как `Decimal`, принимаем строки
- **Идемпотентность:** Повторный импорт с тем же `externalId` безопасен
- **Optimistic Locking:** Версионирование документов для concurrent access
- **Штрихкоды:** Первый в массиве помечается как `isPrimary=true`
- **Логирование:** Мониторинг производительности операций

## База данных

Проект использует MySQL. Основные таблицы:

- `Warehouse` — склады
- `InventoryDocument` — документы пересчёта  
- `InventoryItem` — строки документов
- `InventoryItemBarcode` — штрихкоды товаров

Миграции создаются автоматически через Prisma при выполнении `npm run prisma:migrate`.
