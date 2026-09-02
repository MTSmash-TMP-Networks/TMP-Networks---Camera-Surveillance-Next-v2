import { config, insecureDefaults } from './config.js';
import { logger } from './utils/logger.js';

if (insecureDefaults()) {
  const message = 'Unsichere Standardgeheimnisse aktiv. Bitte .env mit start.sh erzeugen oder Werte manuell setzen.';
  if (process.env.NODE_ENV === 'production') {
    logger.fatal(message);
    process.exit(1);
  }
  logger.warn(message);
}

const [
  { createApp }, { migrate, db }, { healthMonitor }, { discoveryJobService },
  { recordingScheduler }, { retentionManager }, { recordingService }, { recordingCompressionService }, { motionDetectionService },
  { recordingEventDispatcher }, { ptzService }, { cameraRuntimeCoordinator },
  { ptzAutomationInterlock }, { streamOrchestrator }, { eventWebSocketHub }, { domainEventBus }, { aiEventAnalysisService }, { emailNotificationService }, { demoModeSettingsService }, { networkRecordingStorageService },
] = await Promise.all([
  import('./app.js'),
  import('./db/database.js'),
  import('./services/healthMonitor.js'),
  import('./services/DiscoveryJobService.js'),
  import('./services/recording/RecordingScheduler.js'),
  import('./services/recording/RetentionManager.js'),
  import('./services/RecordingService.js'),
  import('./services/recording/RecordingCompressionService.js'),
  import('./services/recording/MotionDetectionService.js'),
  import('./services/recording/RecordingEventDispatcher.js'),
  import('./services/ptz/PtzService.js'),
  import('./services/runtime/CameraRuntimeCoordinator.js'),
  import('./services/runtime/PtzAutomationInterlock.js'),
  import('./services/media/StreamOrchestrator.js'),
  import('./services/events/EventWebSocketHub.js'),
  import('./services/events/DomainEventBus.js'),
  import('./services/ai/AiEventAnalysisService.js'),
  import('./services/notifications/EmailNotificationService.js'),
  import('./services/DemoModeSettingsService.js'),
  import('./services/NetworkRecordingStorageService.js'),
]);

migrate();
demoModeSettingsService.initializeFromLegacyEnv();
aiEventAnalysisService.start();
emailNotificationService.start();
const app = createApp();
const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, database: config.dbPath }, 'TMP Camera Backend gestartet');
  const demoRuntime = demoModeSettingsService.status();
  if (demoRuntime.demoMode) logger.warn({ allowExports: demoRuntime.allowExports }, 'Demo-Modus aktiv: zustandsveraendernde API-Aktionen sind schreibgeschuetzt');
  healthMonitor.start();
  void (async () => {
    try {
      const recovery = await recordingService.recoverInterruptedRecordings();
      if (recovery.recovered) logger.info(recovery, 'Unterbrochene Aufnahmen wurden vor dem Start des Schedulers wiederhergestellt');
    } catch (error) {
      logger.error({ err: error }, 'Startwiederherstellung der Aufnahmen ist fehlgeschlagen');
    } finally {
      // Reconcile compression scratch/backup files before inspecting remote
      // storage. A hard update can stop FFmpeg between file replacement and
      // database commit; compression recovery must establish the authoritative
      // local file first.
      recordingCompressionService.start();
      try {
        await networkRecordingStorageService.reconcile();
      } catch (error) {
        logger.error({ err: error }, 'Aufnahmespeicher-Abgleich beim Start ist fehlgeschlagen');
      }
      networkRecordingStorageService.start();
      discoveryJobService.bootstrap();
      await streamOrchestrator.startPermanentIngestForAll({ wait: false });
      motionDetectionService.start();
      recordingScheduler.start();
      // Retention starts last. It must never delete archive rows before local,
      // remote and compression state have been reconciled after an update.
      retentionManager.start();
    }
  })();
});
eventWebSocketHub.attach(server);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Server wird beendet');
  const forceExit = setTimeout(() => {
    logger.fatal({ signal }, 'Erzwungenes Serverende nach Ablauf des Shutdown-Zeitlimits');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  healthMonitor.stop?.();
  motionDetectionService.stop();
  recordingScheduler.stop();
  retentionManager.stop();
  recordingCompressionService.stop();
  networkRecordingStorageService.stop();
  recordingEventDispatcher.shutdown?.();
  discoveryJobService.shutdown?.();

  try {
    await recordingService.shutdown();
  } catch (error) {
    logger.warn({ err: error }, 'Laufende Aufnahmen konnten beim Herunterfahren nicht vollständig beendet werden');
  }
  try {
    await streamOrchestrator.shutdown?.();
  } catch (error) {
    logger.warn({ err: error }, 'Live-Streams konnten beim Herunterfahren nicht vollständig beendet werden');
  }

  emailNotificationService.shutdown?.();
  aiEventAnalysisService.shutdown?.();
  eventWebSocketHub.shutdown?.();
  ptzService.shutdown?.();
  cameraRuntimeCoordinator.shutdown?.();
  ptzAutomationInterlock.shutdown?.();
  domainEventBus.shutdown?.();

  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch (error) { logger.warn({ err: error }, 'Datenbank konnte nicht sauber geschlossen werden'); }
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Unbehandelte Ausnahme');
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'Unbehandelte Promise-Ablehnung');
});
