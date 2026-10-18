import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller.js';
import { WalletLedgerController } from './wallet-ledger.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({
  controllers: [WalletsController, WalletLedgerController],
  providers: [WalletsService],
})
export class WalletsModule {}
