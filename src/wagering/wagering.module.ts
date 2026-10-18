import { Module } from '@nestjs/common';
import { WagerTransactionsController } from './wager-transactions.controller.js';
import { SubmitWagerTransactionController } from './submit-wager-transaction.controller.js';

@Module({
  controllers: [WagerTransactionsController, SubmitWagerTransactionController],
})
export class WageringModule {}
