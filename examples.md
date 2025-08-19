# Примеры запросов к API

## 1. Импорт документа из 1С

```bash
curl -X POST http://localhost:3000/onec/inventory-documents/import \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "test-doc-001",
    "onecNumber": "ПР-000001", 
    "onecDate": "2025-08-20T10:00:00Z",
    "warehouse": {
      "code": "MAIN",
      "name": "Главный склад"
    },
    "items": [
      {
        "sku": "ITEM001",
        "name": "Тестовый товар 1",
        "unit": "шт",
        "qtyFrom1C": "100",
        "barcodes": ["1234567890123", "2234567890123"]
      },
      {
        "sku": "ITEM002", 
        "name": "Тестовый товар 2",
        "unit": "кг",
        "qtyFrom1C": "50.5",
        "barcodes": ["3234567890123"]
      }
    ]
  }'
```

## 2. Получение документа

```bash
# Замените {DOCUMENT_ID} на ID документа из предыдущего ответа
curl http://localhost:3000/inventory-documents/{DOCUMENT_ID}
```

## 2.1. Получение списка документов по складу

```bash
# Получить все документы для склада MAIN
curl http://localhost:3000/inventory-documents/warehouse/MAIN

# Получить все документы для склада с кодом "WAREHOUSE_01"
curl http://localhost:3000/inventory-documents/warehouse/WAREHOUSE_01
```

## 3. Обновление строк документа

```bash
curl -X PATCH http://localhost:3000/inventory-documents/{DOCUMENT_ID}/items \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "items": [
      {
        "sku": "ITEM001",
        "countedQty": "95",
        "note": "недостача 5 шт"
      },
      {
        "barcode": "3234567890123",
        "countedQty": "48.0"
      }
    ]
  }'
```

## 4. Фиксация документа (расчёт дельт)

```bash
curl -X POST http://localhost:3000/inventory-documents/{DOCUMENT_ID}/revise
```

## 5. Экспорт для 1С

```bash
curl http://localhost:3000/onec/inventory-documents/{DOCUMENT_ID}/export
```

## 6. Подтверждение от 1С

```bash
curl -X POST http://localhost:3000/onec/inventory-documents/{DOCUMENT_ID}/ack
```

## Тестирование с HTTPie (если установлен)

```bash
# Импорт
http POST localhost:3000/onec/inventory-documents/import \
  externalId=test-doc-001 \
  onecNumber=ПР-000001 \
  onecDate=2025-08-20T10:00:00Z \
  warehouse:='{"code":"MAIN","name":"Главный склад"}' \
  items:='[{"sku":"ITEM001","name":"Тестовый товар","unit":"шт","qtyFrom1C":"100","barcodes":["1234567890123"]}]'

# Получение документа
http GET localhost:3000/inventory-documents/{DOCUMENT_ID}

# Обновление строк
http PATCH localhost:3000/inventory-documents/{DOCUMENT_ID}/items \
  version:=1 \
  items:='[{"sku":"ITEM001","countedQty":"95","note":"недостача"}]'

# Фиксация
http POST localhost:3000/inventory-documents/{DOCUMENT_ID}/revise

# Экспорт
http GET localhost:3000/onec/inventory-documents/{DOCUMENT_ID}/export

# Подтверждение
http POST localhost:3000/onec/inventory-documents/{DOCUMENT_ID}/ack
```

## Проверка ошибок

### Конфликт версий (409)
```bash
curl -X PATCH http://localhost:3000/inventory-documents/{DOCUMENT_ID}/items \
  -H "Content-Type: application/json" \
  -d '{
    "version": 999,
    "items": [{"sku": "ITEM001", "countedQty": "100"}]
  }'
```

### Неправильный статус (422)
```bash
# Попытка ревизии уже зафиксированного документа
curl -X POST http://localhost:3000/inventory-documents/{DOCUMENT_ID}/revise
```

### Невалидные данные (400)
```bash
curl -X POST http://localhost:3000/onec/inventory-documents/import \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "test",
    "items": "invalid"
  }'
```
