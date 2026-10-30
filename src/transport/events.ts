import type { IngestTransport } from './http_transport.js';
import type {
  DebugMeta,
  ExceptionData,
  ExceptionMechanism,
  ExceptionValue,
  SeverityLevel,
  StackFrame,
  StackTrace,
  Breadcrumb,
} from '../types.js';

export interface IngestEventParams {
  message: string;
  environment: string;
  level?: SeverityLevel;
  eventType?: 'error' | 'warning' | 'info' | 'debug';
  title?: string;
  stackTrace?: string;
  exception?: ExceptionData;
  debugMeta?: DebugMeta;
  platform?: string;
  release?: string;
  commitSha?: string;
  userId?: string;
  sessionId?: string;
  replayId?: string | null;
  requestId?: string;
  url?: string;
  tags?: Record<string, string>;
  extraJson?: string;
  userAgent?: string;
  timestamp?: string;
  keepalive?: boolean;
  traceId?: string;
  spanId?: string;
  breadcrumbs?: Breadcrumb[];
}

export async function ingestEvent(
  transport: IngestTransport,
  params: IngestEventParams,
): Promise<unknown> {
  const event = serializeEvent(params);
  return transport.postJson(
    '/v1/events',
    { events: [event] },
    { keepalive: params.keepalive, label: 'v1/events' },
  );
}

function serializeEvent(params: IngestEventParams): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    message: params.message,
    level: params.level ?? 'error',
    eventType: params.eventType ?? levelToEventType(params.level ?? 'error'),
  };

  put(wire, 'title', params.title);
  put(wire, 'stackTrace', params.stackTrace);
  if (params.exception) put(wire, 'exception', serializeException(params.exception));
  if (params.debugMeta) put(wire, 'debugMeta', serializeDebugMeta(params.debugMeta));
  put(wire, 'platform', params.platform);
  put(wire, 'release', params.release);
  put(wire, 'commitSha', params.commitSha);
  put(wire, 'userId', params.userId);
  put(wire, 'sessionId', params.sessionId);
  put(wire, 'replayId', params.replayId);
  put(wire, 'requestId', params.requestId);
  put(wire, 'url', params.url);
  put(wire, 'tags', params.tags);
  put(wire, 'extraJson', params.extraJson);
  put(wire, 'userAgent', params.userAgent);
  put(wire, 'timestamp', params.timestamp);
  put(wire, 'traceId', params.traceId);
  put(wire, 'spanId', params.spanId);
  if (params.breadcrumbs && params.breadcrumbs.length) {
    wire.breadcrumbs = params.breadcrumbs.map(serializeBreadcrumb);
  }

  return wire;
}

function levelToEventType(level: SeverityLevel): 'error' | 'warning' | 'info' | 'debug' {
  switch (level) {
    case 'fatal':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    case 'debug':
    default:
      return 'debug';
  }
}

function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value == null) return;
  if (typeof value === 'string' && value === '') return;
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (Object.keys(value as object).length === 0) return;
  }
  target[key] = value;
}

function serializeBreadcrumb(crumb: Breadcrumb): Record<string, unknown> {
  const out: Record<string, unknown> = {
    timestamp: crumb.timestamp,
    type: crumb.type,
  };
  if (crumb.category) out.category = crumb.category;
  if (crumb.message) out.message = crumb.message;
  if (crumb.level) out.level = crumb.level;
  if (crumb.data && Object.keys(crumb.data).length) out.data = crumb.data;
  return out;
}

function serializeException(data: ExceptionData): Record<string, unknown> {
  return {
    values: data.values.map(serializeExceptionValue),
  };
}

function serializeExceptionValue(
  value: ExceptionValue,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (value.type != null) out.type = value.type;
  if (value.value != null) out.value = value.value;
  if (value.module != null) out.module = value.module;
  if (value.threadId != null) out.threadId = value.threadId;
  if (value.code != null) out.code = value.code;
  if (value.mechanism) out.mechanism = serializeMechanism(value.mechanism);
  if (value.stacktrace) out.stacktrace = serializeStackTrace(value.stacktrace);
  return out;
}

function serializeMechanism(
  mechanism: ExceptionMechanism,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: mechanism.type,
  };
  if (mechanism.handled != null) out.handled = mechanism.handled;
  if (mechanism.synthetic != null) out.synthetic = mechanism.synthetic;
  return out;
}

function serializeStackTrace(stack: StackTrace): Record<string, unknown> {
  const out: Record<string, unknown> = {
    frames: stack.frames.map(serializeStackFrame),
  };
  if (stack.registers) out.registers = stack.registers;
  return out;
}

function serializeStackFrame(frame: StackFrame): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (frame.filename != null) out.filename = frame.filename;
  if (frame.absPath != null) out.absPath = frame.absPath;
  if (frame.functionName != null) out.functionName = frame.functionName;
  if (frame.rawFunction != null) out.rawFunction = frame.rawFunction;
  if (frame.module != null) out.module = frame.module;
  if (frame.package != null) out.package = frame.package;
  if (frame.platform != null) out.platform = frame.platform;
  if (frame.lineno != null) out.lineno = frame.lineno;
  if (frame.colno != null) out.colno = frame.colno;
  if (frame.inApp != null) out.inApp = frame.inApp;
  if (frame.instructionAddr != null) out.instructionAddr = frame.instructionAddr;
  if (frame.symbolAddr != null) out.symbolAddr = frame.symbolAddr;
  if (frame.imageAddr != null) out.imageAddr = frame.imageAddr;
  if (frame.addrMode != null) out.addrMode = frame.addrMode;
  if (frame.contextLine != null) out.contextLine = frame.contextLine;
  if (frame.preContext != null) out.preContext = frame.preContext;
  if (frame.postContext != null) out.postContext = frame.postContext;
  if (frame.vars != null) out.vars = frame.vars;
  if (frame.stackStart != null) out.stackStart = frame.stackStart;
  return out;
}

function serializeDebugMeta(meta: DebugMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.images) {
    out.images = meta.images.map((image) => {
      const img: Record<string, unknown> = {};
      if (image.type != null) img.type = image.type;
      if (image.imageAddr != null) img.imageAddr = image.imageAddr;
      if (image.imageSize != null) img.imageSize = image.imageSize;
      if (image.debugId != null) img.debugId = image.debugId;
      if (image.debugFile != null) img.debugFile = image.debugFile;
      if (image.codeId != null) img.codeId = image.codeId;
      if (image.codeFile != null) img.codeFile = image.codeFile;
      if (image.arch != null) img.arch = image.arch;
      return img;
    });
  }
  return out;
}
