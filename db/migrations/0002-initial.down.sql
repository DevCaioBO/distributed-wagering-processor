BEGIN;

DROP TABLE wallet_ledger_entries;
DROP TABLE wager_transactions;
DROP TABLE wallets;
DROP FUNCTION forbid_ledger_mutation();

COMMIT;