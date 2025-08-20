import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 20000, // максимальное время ожидания начала транзакции (20 сек)
    timeout: 30000, // максимальное время выполнения транзакции (30 сек)
  },
});

export default prisma;
