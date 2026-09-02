import { cameraRepository } from '../cameraRepository.js';
import { cameraEventLog } from '../CameraEventLog.js';
import { domainEventBus } from '../events/DomainEventBus.js';
import { snapshotService } from '../media/SnapshotService.js';
import { notificationSettingsService } from '../notifications/NotificationSettingsService.js';
import { recordingPolicyRepository } from '../recording/RecordingPolicyRepository.js';
import { recordingRepository } from '../recordingRepository.js';
import { logger } from '../../utils/logger.js';
import { aiEventAnalysisSettingsService } from './AiEventAnalysisSettingsService.js';

const MOTION_CODES = new Set(['MOTION_DETECTED', 'MOTION_RETRIGGERED']);
const RECORDING_STARTED = 'RECORDING_STARTED';
const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_TEXT = 64 * 1024;

const LANGUAGE_NAMES = {
  de: 'German', en: 'English', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pl: 'Polish', 'pt-BR': 'Brazilian Portuguese', tr: 'Turkish',
  cs: 'Czech', da: 'Danish', sv: 'Swedish', nb: 'Norwegian Bokmal', fi: 'Finnish', ro: 'Romanian', hu: 'Hungarian', el: 'Greek', uk: 'Ukrainian', ru: 'Russian',
  ar: 'Arabic', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', ja: 'Japanese', ko: 'Korean',
};

const AI_LANGUAGE_ALIASES = Object.freeze({
  no: 'nb', pt: 'pt-BR', 'pt-br': 'pt-BR', zh: 'zh-CN', 'zh-hans': 'zh-CN', 'zh-hant': 'zh-TW', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW',
});

function normalizeAnalysisLanguage(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return null;
  const direct = Object.keys(LANGUAGE_NAMES).find((code) => code.toLowerCase() === raw.toLowerCase());
  if (direct) return direct;
  const lower = raw.toLowerCase().replace(/_/g, '-');
  if (AI_LANGUAGE_ALIASES[lower]) return AI_LANGUAGE_ALIASES[lower];
  const base = lower.split('-')[0];
  return Object.keys(LANGUAGE_NAMES).find((code) => code.toLowerCase() === base) || AI_LANGUAGE_ALIASES[base] || null;
}

const ANALYSIS_FALLBACKS = Object.freeze({
  de: { eventType: 'unbekannt', title: 'Kameraereignis', description: 'Es konnte keine verlässliche Beschreibung erzeugt werden.', activity: 'unbekannt' },
  en: { eventType: 'unknown', title: 'Camera event', description: 'No reliable description could be generated.', activity: 'unknown' },
  fr: { eventType: 'inconnu', title: 'Événement caméra', description: 'Aucune description fiable n’a pu être générée.', activity: 'inconnue' },
  es: { eventType: 'desconocido', title: 'Evento de cámara', description: 'No se pudo generar una descripción fiable.', activity: 'desconocida' },
  it: { eventType: 'sconosciuto', title: 'Evento telecamera', description: 'Non è stato possibile generare una descrizione affidabile.', activity: 'sconosciuta' },
  nl: { eventType: 'onbekend', title: 'Cameragebeurtenis', description: 'Er kon geen betrouwbare beschrijving worden gemaakt.', activity: 'onbekend' },
  pl: { eventType: 'nieznane', title: 'Zdarzenie kamery', description: 'Nie udało się wygenerować wiarygodnego opisu.', activity: 'nieznana' },
  'pt-BR': { eventType: 'desconhecido', title: 'Evento da câmera', description: 'Não foi possível gerar uma descrição confiável.', activity: 'desconhecida' },
  tr: { eventType: 'bilinmiyor', title: 'Kamera olayı', description: 'Güvenilir bir açıklama oluşturulamadı.', activity: 'bilinmiyor' },
  cs: { eventType: 'neznámé', title: 'Událost kamery', description: 'Nepodařilo se vytvořit spolehlivý popis.', activity: 'neznámá' },
  da: { eventType: 'ukendt', title: 'Kamerahændelse', description: 'Der kunne ikke oprettes en pålidelig beskrivelse.', activity: 'ukendt' },
  sv: { eventType: 'okänd', title: 'Kamerahändelse', description: 'Ingen tillförlitlig beskrivning kunde skapas.', activity: 'okänd' },
  nb: { eventType: 'ukjent', title: 'Kamerahendelse', description: 'Det kunne ikke opprettes en pålitelig beskrivelse.', activity: 'ukjent' },
  fi: { eventType: 'tuntematon', title: 'Kameratapahtuma', description: 'Luotettavaa kuvausta ei voitu luoda.', activity: 'tuntematon' },
  ro: { eventType: 'necunoscut', title: 'Eveniment cameră', description: 'Nu a putut fi generată o descriere fiabilă.', activity: 'necunoscută' },
  hu: { eventType: 'ismeretlen', title: 'Kameraesemény', description: 'Nem sikerült megbízható leírást készíteni.', activity: 'ismeretlen' },
  el: { eventType: 'άγνωστο', title: 'Συμβάν κάμερας', description: 'Δεν ήταν δυνατή η δημιουργία αξιόπιστης περιγραφής.', activity: 'άγνωστη' },
  uk: { eventType: 'невідомо', title: 'Подія камери', description: 'Не вдалося створити надійний опис.', activity: 'невідома' },
  ru: { eventType: 'неизвестно', title: 'Событие камеры', description: 'Не удалось создать достоверное описание.', activity: 'неизвестна' },
  ar: { eventType: 'غير معروف', title: 'حدث الكاميرا', description: 'تعذر إنشاء وصف موثوق.', activity: 'غير معروف' },
  'zh-CN': { eventType: '未知', title: '摄像机事件', description: '无法生成可靠的描述。', activity: '未知' },
  'zh-TW': { eventType: '未知', title: '攝影機事件', description: '無法產生可靠的描述。', activity: '未知' },
  ja: { eventType: '不明', title: 'カメライベント', description: '信頼できる説明を生成できませんでした。', activity: '不明' },
  ko: { eventType: '알 수 없음', title: '카메라 이벤트', description: '신뢰할 수 있는 설명을 생성할 수 없습니다.', activity: '알 수 없음' },
});

function analysisFallback(language) { return ANALYSIS_FALLBACKS[normalizeAnalysisLanguage(language) || 'en'] || ANALYSIS_FALLBACKS.en; }

function sleep(ms) { return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }
function cleanString(value, max = 500) { return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max); }
function clamp(value, min, max, fallback = min) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function uniqueStrings(items, limit = 12) { return [...new Set((Array.isArray(items) ? items : []).map((item) => cleanString(item, 80)).filter(Boolean))].slice(0, limit); }

export const AI_EVENT_ANALYSIS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    event_type: { type: 'string', maxLength: 80 },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
    title: { type: 'string', maxLength: 160 },
    description: { type: 'string', maxLength: 1200 },
    objects: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 12 },
    activity: { type: 'string', maxLength: 160 },
    people_count: { type: 'integer', minimum: 0, maximum: 100 },
    vehicle_count: { type: 'integer', minimum: 0, maximum: 100 },
    animal_count: { type: 'integer', minimum: 0, maximum: 100 },
    notification_recommended: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['event_type', 'priority', 'title', 'description', 'objects', 'activity', 'people_count', 'vehicle_count', 'animal_count', 'notification_recommended', 'confidence'],
});

export function normalizeAiAnalysis(value = {}, language = 'en') {
  const fallback = analysisFallback(language);
  const priority = ['low', 'normal', 'high', 'critical'].includes(value.priority) ? value.priority : 'normal';
  return {
    eventType: cleanString(value.event_type ?? value.eventType ?? fallback.eventType, 80) || fallback.eventType,
    priority,
    title: cleanString(value.title ?? '', 160) || fallback.title,
    description: cleanString(value.description ?? '', 1200) || fallback.description,
    objects: uniqueStrings(value.objects),
    activity: cleanString(value.activity ?? '', 160) || fallback.activity,
    peopleCount: Math.round(clamp(value.people_count ?? value.peopleCount, 0, 100, 0)),
    vehicleCount: Math.round(clamp(value.vehicle_count ?? value.vehicleCount, 0, 100, 0)),
    animalCount: Math.round(clamp(value.animal_count ?? value.animalCount, 0, 100, 0)),
    notificationRecommended: (value.notification_recommended ?? value.notificationRecommended) !== false,
    confidence: Number(clamp(value.confidence, 0, 1, 0).toFixed(3)),
  };
}

function extractJsonText(text) {
  const source = cleanString(text, MAX_RESPONSE_TEXT);
  if (!source) throw new Error('KI-Antwort enthielt keinen Text');
  try { return JSON.parse(source); } catch { /* continue */ }
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) { try { return JSON.parse(fenced.trim()); } catch { /* continue */ } }
  const start = source.indexOf('{'); const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(source.slice(start, end + 1)); } catch { /* continue */ } }
  throw new Error('KI-Antwort war kein gueltiges strukturiertes JSON');
}

export function extractProviderAnalysis(payload, apiMode = 'responses', language = 'en') {
  if (!payload || typeof payload !== 'object') throw new Error('KI-Anbieter lieferte keine gueltige Antwort');
  if (apiMode === 'chat_completions') {
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === 'string') return normalizeAiAnalysis(extractJsonText(content), language);
    if (Array.isArray(content)) {
      const text = content.map((item) => item?.text || item?.content || '').filter(Boolean).join('\n');
      if (text) return normalizeAiAnalysis(extractJsonText(text), language);
    }
  }
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return normalizeAiAnalysis(extractJsonText(payload.output_text), language);
  const texts = [];
  for (const output of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      if (typeof content?.text === 'string') texts.push(content.text);
      else if (typeof content?.output_text === 'string') texts.push(content.output_text);
    }
  }
  if (texts.length) return normalizeAiAnalysis(extractJsonText(texts.join('\n')), language);
  throw new Error('KI-Antwort enthielt keine auswertbare strukturierte Ausgabe');
}

function endpointUrl(baseUrl, apiMode) {
  const suffix = apiMode === 'chat_completions' ? 'chat/completions' : 'responses';
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (base.endsWith(`/${suffix}`)) return base;
  return `${base}/${suffix}`;
}

export function buildProviderRequest({ settings, prompt, frames }) {
  const imageInputs = frames.map((frame) => ({
    type: 'input_image',
    image_url: `data:${frame.contentType || 'image/jpeg'};base64,${frame.buffer.toString('base64')}`,
    detail: settings.imageDetail,
  }));
  if (settings.apiMode === 'chat_completions') {
    const content = [
      { type: 'text', text: prompt },
      ...imageInputs.map((item) => ({ type: 'image_url', image_url: { url: item.image_url, detail: item.detail } })),
    ];
    const body = {
      model: settings.model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name: 'camera_event_analysis', strict: true, schema: AI_EVENT_ANALYSIS_SCHEMA } },
      temperature: 0.1,
    };
    if (settings.reasoningEffort !== 'none') body.reasoning_effort = settings.reasoningEffort;
    return { url: endpointUrl(settings.baseUrl, settings.apiMode), body };
  }
  const body = {
    model: settings.model,
    store: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...imageInputs] }],
    text: { format: { type: 'json_schema', name: 'camera_event_analysis', strict: true, schema: AI_EVENT_ANALYSIS_SCHEMA } },
    max_output_tokens: 1200,
  };
  if (settings.reasoningEffort !== 'none') body.reasoning = { effort: settings.reasoningEffort };
  return { url: endpointUrl(settings.baseUrl, settings.apiMode), body };
}

function resolveLanguage(settings, requested = null) {
  if (settings.language && settings.language !== 'auto') return normalizeAnalysisLanguage(settings.language) || 'en';
  const requestedLanguage = normalizeAnalysisLanguage(requested);
  if (requestedLanguage) return requestedLanguage;
  const notificationLanguage = normalizeAnalysisLanguage(notificationSettingsService.get().language);
  return notificationLanguage || 'en';
}

function buildPrompt({ camera, language, frameCount, context = 'motion' }) {
  const languageName = LANGUAGE_NAMES[language] || 'English';
  return [
    'You are a security camera event description component.',
    `Analyze the ${frameCount} chronological camera frame${frameCount === 1 ? '' : 's'} and describe only what is visibly supported by the images.`,
    `Context: ${context}. Camera: ${cleanString(camera?.name || camera?.id || 'camera', 120)}${camera?.location ? `; location label: ${cleanString(camera.location, 160)}` : ''}.`,
    `Write title, description, activity and object labels in ${languageName}. Keep descriptions concise and useful for a notification.`,
    'Do not identify or guess the identity of any person. Do not perform face recognition. Do not infer protected or sensitive traits, emotions, health, criminality, intent, or relationships.',
    'If something is uncertain, describe the uncertainty instead of guessing. Do not invent events that are not visible.',
    'Use priority critical only for an immediately visible, concrete safety emergency. Use high sparingly for clearly unusual or security-relevant activity.',
    'Set notification_recommended to false for obvious harmless environmental changes, empty frames, lighting changes, or ordinary background movement; otherwise true when a person, vehicle, animal, delivery, entry/exit, or other meaningful activity is visible.',
    'Return only the requested structured JSON data.',
  ].join('\n');
}

function isConfigured(settings) {
  if (!settings.model || !settings.baseUrl) return false;
  return settings.provider === 'openai' ? Boolean(settings.apiKey) : true;
}

class AiEventAnalysisService {
  constructor() {
    this.started = false;
    this.inflight = new Map();
    this.lastByCamera = new Map();
    this.active = 0;
    this.waiters = [];
    this.stats = { total: 0, succeeded: 0, failed: 0, skipped: 0, lastCompletedAt: null, lastError: null, lastAnalysis: null };
    this.onEvent = (event) => { void this.handleDomainEvent(event).catch((error) => logger.warn({ err: error }, 'KI-Ereignisanalyse konnte Domain-Event nicht verarbeiten')); };
  }

  start() {
    if (this.started) return;
    this.started = true;
    domainEventBus.on('event', this.onEvent);
  }

  shutdown() {
    if (!this.started) return;
    domainEventBus.off('event', this.onEvent);
    this.started = false;
  }

  status() {
    const settings = aiEventAnalysisSettingsService.get();
    const transportConfigured = settings.provider === 'openai' ? settings.apiKeyConfigured : Boolean(settings.baseUrl && settings.model);
    return {
      enabled: settings.enabled,
      configured: Boolean(settings.model && settings.baseUrl && transportConfigured),
      provider: settings.provider,
      model: settings.model,
      active: this.active,
      pending: this.waiters.length,
      inFlight: this.inflight.size,
      ...this.stats,
    };
  }

  async acquire() {
    if (this.active < 2) { this.active += 1; return; }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }

  shouldCooldown(cameraId, seconds) {
    const interval = Math.max(0, Number(seconds || 0)) * 1000;
    if (!interval) return false;
    const last = this.lastByCamera.get(String(cameraId)) || 0;
    if (Date.now() - last < interval) return true;
    this.lastByCamera.set(String(cameraId), Date.now());
    return false;
  }

  async captureFrames(cameraId, count, intervalMs) {
    const frames = [];
    let lastError = null;
    for (let index = 0; index < count; index += 1) {
      if (index) await sleep(intervalMs);
      try {
        const frame = await snapshotService.capture(cameraId);
        if (!frame?.buffer?.length) throw new Error('Leeres Snapshot-Bild');
        if (frame.buffer.length > MAX_FRAME_BYTES) throw new Error('Snapshot ist fuer die KI-Analyse zu gross');
        frames.push({ contentType: String(frame.contentType || 'image/jpeg').split(';')[0], buffer: frame.buffer });
      } catch (error) {
        lastError = error;
        logger.debug({ cameraId, frameIndex: index, err: error }, 'KI-Analyse konnte einen Snapshot nicht erfassen');
      }
    }
    if (!frames.length) throw lastError || new Error('Keine Snapshots fuer die KI-Analyse verfuegbar');
    return frames;
  }

  async callProvider({ settings, camera, language, context, frames }) {
    if (!isConfigured(settings)) throw new Error('KI-Anbieter ist nicht vollstaendig konfiguriert');
    const prompt = buildPrompt({ camera, language, frameCount: frames.length, context });
    const { url, body } = buildProviderRequest({ settings, prompt, frames });
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    const execute = async (requestBody) => {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody), signal: controller.signal });
      const raw = (await response.text()).slice(0, MAX_RESPONSE_TEXT);
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
      if (!response.ok) {
        const reason = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
        return { ok: false, status: response.status, reason: cleanString(reason, 800), raw };
      }
      if (!payload) throw new Error('KI-Anbieter lieferte kein gueltiges JSON-Protokoll');
      return { ok: true, payload };
    };
    try {
      let result = await execute(body);
      if (!result.ok && settings.provider === 'compatible' && [400, 404, 415, 422].includes(result.status)) {
        const relaxed = structuredClone(body);
        if (settings.apiMode === 'chat_completions') {
          delete relaxed.response_format;
          delete relaxed.reasoning_effort;
        } else {
          delete relaxed.text;
          delete relaxed.reasoning;
        }
        logger.info({ provider: settings.provider, apiMode: settings.apiMode, status: result.status }, 'OpenAI-kompatibler KI-Endpunkt wird ohne Structured-Output-Erweiterung erneut versucht');
        result = await execute(relaxed);
      }
      if (!result.ok) throw new Error(`KI-Anbieter HTTP ${result.status}: ${result.reason}`);
      return extractProviderAnalysis(result.payload, settings.apiMode, language);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`KI-Anfrage nach ${settings.requestTimeoutMs} ms abgebrochen`);
      throw error;
    } finally { clearTimeout(timer); }
  }

  persistAnalysis({ cameraId, eventId = null, recordingId = null, analysis, settings, frameCount, language }) {
    const metadata = {
      aiAnalysis: analysis,
      aiAnalyzedAt: new Date().toISOString(),
      aiProvider: settings.provider,
      aiModel: settings.model,
      aiFrameCount: frameCount,
      aiLanguage: language,
    };
    if (eventId) {
      recordingPolicyRepository.mergeEventMetadata?.(eventId, metadata);
      recordingRepository.mergeMetadataByEventId?.(eventId, metadata);
    }
    if (recordingId) recordingRepository.mergeMetadata?.(recordingId, metadata);
    return metadata;
  }

  async analyze({ cameraId, eventId = null, recordingId = null, context = 'motion', requestedLanguage = null, force = false, persist = true }) {
    const settings = aiEventAnalysisSettingsService.transport();
    const sourceEnabled = context === 'motion' ? settings.analyze.motion : context === 'manual-recording' ? settings.analyze.manualRecording : settings.analyze.continuousRecording;
    if (!force && (!settings.enabled || !sourceEnabled)) { this.stats.skipped += 1; return { analyzed: false, reason: 'disabled' }; }
    if (!isConfigured(settings)) { this.stats.skipped += 1; return { analyzed: false, reason: 'not_configured' }; }
    const dedupeKey = eventId ? `event:${eventId}` : recordingId ? `recording:${recordingId}` : `camera:${cameraId}:${context}`;
    if (this.inflight.has(dedupeKey)) return this.inflight.get(dedupeKey);
    if (!force && this.shouldCooldown(cameraId, settings.analysisCooldownSeconds)) { this.stats.skipped += 1; return { analyzed: false, reason: 'cooldown' }; }

    const task = (async () => {
      await this.acquire();
      this.stats.total += 1;
      try {
        const camera = cameraRepository.get(cameraId);
        if (!camera) throw new Error('Kamera nicht gefunden');
        const language = resolveLanguage(settings, requestedLanguage);
        cameraEventLog.append(cameraId, {
          level: 'info', component: 'ai-event-analysis', code: 'AI_EVENT_ANALYSIS_STARTED',
          message: 'KI-Ereignisanalyse wurde gestartet',
          details: { eventId, recordingId, context, provider: settings.provider, model: settings.model, requestedFrames: settings.frameCount },
        });
        const frames = await this.captureFrames(cameraId, settings.frameCount, settings.frameIntervalMs);
        const analysis = await this.callProvider({ settings, camera, language, context, frames });
        const metadata = persist ? this.persistAnalysis({ cameraId, eventId, recordingId, analysis, settings, frameCount: frames.length, language }) : null;
        this.stats.succeeded += 1;
        this.stats.lastCompletedAt = new Date().toISOString();
        this.stats.lastError = null;
        this.stats.lastAnalysis = { cameraId, eventId, recordingId, analysis, provider: settings.provider, model: settings.model, frameCount: frames.length, language, createdAt: this.stats.lastCompletedAt };
        cameraEventLog.append(cameraId, {
          level: analysis.priority === 'critical' ? 'warn' : 'info', component: 'ai-event-analysis', code: 'AI_EVENT_ANALYSIS_COMPLETED',
          message: analysis.description,
          details: { eventId, recordingId, context, analysis, provider: settings.provider, model: settings.model, frameCount: frames.length, language, persisted: Boolean(metadata) },
        });
        return { analyzed: true, analysis, frameCount: frames.length, language, provider: settings.provider, model: settings.model };
      } catch (error) {
        this.stats.failed += 1;
        this.stats.lastError = cleanString(error?.message || error, 800);
        if (cameraId) cameraEventLog.append(cameraId, {
          level: 'warn', component: 'ai-event-analysis', code: 'AI_EVENT_ANALYSIS_FAILED',
          message: 'KI-Ereignisanalyse ist fehlgeschlagen',
          details: { eventId, recordingId, context, provider: settings.provider, model: settings.model, error: this.stats.lastError },
        });
        logger.warn({ cameraId, eventId, recordingId, err: error }, 'KI-Ereignisanalyse fehlgeschlagen');
        return { analyzed: false, reason: 'analysis_failed', error: this.stats.lastError };
      } finally { this.release(); }
    })().finally(() => this.inflight.delete(dedupeKey));
    this.inflight.set(dedupeKey, task);
    return task;
  }

  async analyzeMotionPayload(payload, { language = null } = {}) {
    const details = payload?.details || {};
    return this.analyze({ cameraId: payload?.cameraId, eventId: details.eventId || null, context: 'motion', requestedLanguage: language });
  }

  async test(cameraId, { language = null } = {}) {
    return this.analyze({ cameraId, context: 'test', requestedLanguage: language, force: true, persist: false });
  }

  async handleDomainEvent(event) {
    if (!this.started || event?.type !== 'camera.log') return;
    const payload = event.payload || {};
    const code = String(payload.code || '');
    const settings = aiEventAnalysisSettingsService.get();
    if (!settings.enabled) return;
    if (MOTION_CODES.has(code) && settings.analyze.motion) {
      await this.analyzeMotionPayload(payload);
      return;
    }
    if (code !== RECORDING_STARTED) return;
    const triggerType = String(payload.details?.triggerType || '').toLowerCase();
    if (triggerType === 'event') {
      const eventId = payload.details?.eventId || null;
      const recordingId = payload.details?.recordingId || null;
      const event = eventId ? recordingPolicyRepository.getEvent?.(eventId) : null;
      if (recordingId && event?.metadata?.aiAnalysis) {
        recordingRepository.mergeMetadata?.(recordingId, {
          aiAnalysis: event.metadata.aiAnalysis,
          aiAnalyzedAt: event.metadata.aiAnalyzedAt || null,
          aiProvider: event.metadata.aiProvider || null,
          aiModel: event.metadata.aiModel || null,
          aiFrameCount: event.metadata.aiFrameCount || null,
          aiLanguage: event.metadata.aiLanguage || null,
        });
      }
      return;
    }
    const isManual = triggerType === 'manual';
    if ((isManual && !settings.analyze.manualRecording) || (!isManual && !settings.analyze.continuousRecording)) return;
    await this.analyze({
      cameraId: payload.cameraId,
      recordingId: payload.details?.recordingId || null,
      eventId: payload.details?.eventId || null,
      context: isManual ? 'manual-recording' : 'continuous-recording',
    });
  }
}

export const aiEventAnalysisService = new AiEventAnalysisService();
