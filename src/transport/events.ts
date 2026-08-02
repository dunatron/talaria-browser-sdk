import type { ServerpodTransport } from './serverpod.js';
import type {
  DebugMeta,
  ExceptionData,
  ExceptionMechanism,
  ExceptionValue,
  SeverityLevel,
  StackFrame,
  StackTrace,
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
  userId?: string;
  sessionId?: string;
  replayId?: string | null;
  requestId?: string;
  url?: string;
  tags?: Record<string, string>;
  extraJson?: string;
  timestamp?: string;
  keepalive?: boolean;
}

export async function ingestEvent(
  transport: ServerpodTransport,
  params: IngestEventParams,
): Promise<unknown> {
  const input: Record<string, unknown> = {
    __className__: 'IngestEventInput',
    message: params.message,
    environment: params.environment,
  };

  if (params.level) input.level = params.level;
  if (params.eventType) input.eventType = params.eventType;
  if (params.title) input.title = params.title;
  if (params.stackTrace) input.stackTrace = params.stackTrace;
  if (params.exception) input.exception = serializeException(params.exception);
  if (params.debugMeta) input.debugMeta = serializeDebugMeta(params.debugMeta);
  if (params.platform) input.platform = params.platform;
  if (params.release) input.release = params.release;
  if (params.userId) input.userId = params.userId;
  if (params.sessionId) input.sessionId = params.sessionId;
  if (params.replayId) input.replayId = params.replayId;
  if (params.requestId) input.requestId = params.requestId;
  if (params.url) input.url = params.url;
  if (params.tags) input.tags = params.tags;
  if (params.extraJson) input.extraJson = params.extraJson;
  if (params.timestamp) input.timestamp = params.timestamp;

  return transport.call(
    'events',
    'ingest',
    { input },
    { keepalive: params.keepalive },
  );
}

function serializeException(data: ExceptionData): Record<string, unknown> {
  return {
    __className__: 'ExceptionDataDto',
    values: data.values.map(serializeExceptionValue),
  };
}

function serializeExceptionValue(
  value: ExceptionValue,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'ExceptionValueDto',
  };
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
    __className__: 'ExceptionMechanismDto',
    type: mechanism.type,
  };
  if (mechanism.handled != null) out.handled = mechanism.handled;
  if (mechanism.synthetic != null) out.synthetic = mechanism.synthetic;
  return out;
}

function serializeStackTrace(stack: StackTrace): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'StackTraceDto',
    frames: stack.frames.map(serializeStackFrame),
  };
  if (stack.registers) out.registers = stack.registers;
  return out;
}

function serializeStackFrame(frame: StackFrame): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'StackFrameDto',
  };
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
  const out: Record<string, unknown> = {
    __className__: 'DebugMetaDto',
  };
  if (meta.images) {
    out.images = meta.images.map((image) => {
      const img: Record<string, unknown> = {
        __className__: 'DebugImageDto',
      };
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
