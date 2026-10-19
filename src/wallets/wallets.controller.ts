import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { WalletsService, type WalletResponse } from './wallets.service.js';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  create(@Body() dto: CreateWalletDto, @Req() req: Request): Promise<WalletResponse> {
    const correlationId =
      (req as Request & { correlationId?: string }).correlationId ?? '';
    return this.walletsService.create(dto, correlationId);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<WalletResponse> {
    return this.walletsService.findById(id);
  }

  @Get(':id/reconcile')
  reconcile(@Param('id') id: string) {
    return this.walletsService.reconcile(id);
  }

  /**
   * Rota canônica do desafio: `POST /wallets/:walletId/reconciliation`.
   * Mesmo caso de uso do GET `:id/reconcile` — a reconciliação é uma leitura
   * de conferência, não uma escrita.
   */
  @Post(':id/reconciliation')
  reconcilePost(@Param('id') id: string) {
    return this.walletsService.reconcile(id);
  }
}
