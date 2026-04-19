import {
  analyzeTelegramBridgeAdapterDryRunContract,
  buildTelegramBridgeAdapterDryRunContractResult,
} from '../../../shared/telegram/index.js';

export class TelegramBridgeAdapterDryRunContractService {
  describe() {
    return Object.freeze({
      serviceName: 'bridge-adapter-dry-run-contract-service',
      status: 'dry_run_contract_ready',
      dependencyKeys: [],
    });
  }

  analyzeFrozenHandoffSnapshot(handoffSnapshot) {
    return analyzeTelegramBridgeAdapterDryRunContract(handoffSnapshot);
  }

  validateFrozenHandoffSnapshot(handoffSnapshot) {
    return buildTelegramBridgeAdapterDryRunContractResult(handoffSnapshot);
  }

  readDryRunContract(handoffSnapshot) {
    return this.validateFrozenHandoffSnapshot(handoffSnapshot);
  }
}
