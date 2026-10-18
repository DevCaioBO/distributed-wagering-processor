export class CreateWalletDto {
  playerId!: string;
  initialBalance!: { amount: string; currency: string };
}
