import { Module } from '@nestjs/common';
import { WagerTransactionsController } from './wager-transactions.controller.js';
import { SubmitWagerTransactionController } from './submit-wager-transaction.controller.js';
import { ProviderTransactionsController } from './provider-transactions.controller.js';

@Module({
  controllers: [
    WagerTransactionsController,
    SubmitWagerTransactionController,
    ProviderTransactionsController,
  ],
})
export class WageringModule {}
