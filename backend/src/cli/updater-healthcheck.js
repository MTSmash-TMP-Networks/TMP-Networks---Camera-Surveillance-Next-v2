import { updaterClient } from '../services/updater/UpdaterClient.js';

const result = await updaterClient.health();
process.stdout.write(`${JSON.stringify({ status: result.status, reachable: result.reachable, installReady: result.installReady, message: result.message, connection: result.connection, issueCodes: result.issueCodes, diagnosticId: result.diagnosticId }, null, 2)}\n`);
process.exit(result.reachable ? 0 : 1);
