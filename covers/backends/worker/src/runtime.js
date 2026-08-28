const ABI_VERSION = 1;
const REQUEST_MAGIC = new Uint8Array([0x50, 0x52, 0x51, 0x31]);
const RESPONSE_MAGIC = new Uint8Array([0x50, 0x52, 0x52, 0x31]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const runtimeBindings = {
  picorbWorkerJspiAdd: async (left, right) => left + right,
  picorbWorkerKvGet: async () => {
    throw new Error("PICORUBY_KV binding is not configured");
  },
  picorbWorkerKvSet: async () => {
    throw new Error("PICORUBY_KV binding is not configured");
  },
};

class FrameWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
  }

  append(bytes) {
    this.parts.push(bytes);
    this.length += bytes.byteLength;
  }

  appendU32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.append(bytes);
  }

  appendString(value) {
    this.appendBytes(encoder.encode(value));
  }

  appendBytes(bytes) {
    this.appendU32(bytes.byteLength);
    this.append(bytes);
  }

  finish() {
    const frame = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      frame.set(part, offset);
      offset += part.byteLength;
    }
    return frame;
  }
}

class FrameReader {
  constructor(frame) {
    this.frame = frame;
    this.offset = 0;
  }

  read(length) {
    if (length < 0 || this.offset + length > this.frame.byteLength) {
      throw new Error("Truncated PicoRuby Worker response frame");
    }
    const bytes = this.frame.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readU32() {
    const bytes = this.read(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  readString() {
    return decoder.decode(this.read(this.readU32()));
  }

  finish() {
    if (this.offset !== this.frame.byteLength) {
      throw new Error("PicoRuby Worker response frame has trailing bytes");
    }
  }
}

function copyToWasm(module, bytes) {
  const pointer = module._malloc(Math.max(bytes.byteLength, 1));
  if (pointer === 0) throw new Error("PicoRuby Wasm allocation failed");
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function readError(module) {
  const pointer = module._picorb_worker_error_ptr();
  const length = module._picorb_worker_error_len();
  return pointer === 0 || length === 0 ? "" : decoder.decode(module.HEAPU8.subarray(pointer, pointer + length));
}

async function requestBody(request) {
  return new Uint8Array(await request.arrayBuffer());
}

async function encodeRequest(request) {
  const url = new URL(request.url);
  const scheme = url.protocol.slice(0, -1);
  const headers = Array.from(request.headers.entries());
  const writer = new FrameWriter();

  writer.append(REQUEST_MAGIC);
  writer.appendString(request.method);
  writer.appendString(scheme);
  writer.appendString(url.hostname);
  writer.appendString(url.port || (scheme === "https" ? "443" : "80"));
  writer.appendString(url.host);
  writer.appendString(url.pathname || "/");
  writer.appendString(url.search.length > 0 ? url.search.slice(1) : "");
  writer.appendString(request.cf?.httpProtocol || "HTTP/1.1");
  writer.appendU32(headers.length);
  for (const [name, value] of headers) {
    writer.appendString(name);
    writer.appendString(value);
  }
  writer.appendBytes(await requestBody(request));
  return writer.finish();
}

function decodeResponse(frame, requestMethod) {
  const reader = new FrameReader(frame);
  const magic = reader.read(RESPONSE_MAGIC.byteLength);
  if (!magic.every((value, index) => value === RESPONSE_MAGIC[index])) {
    throw new Error("Unsupported PicoRuby Worker response frame");
  }

  const status = reader.readU32();
  const headers = new Headers();
  for (let index = 0, count = reader.readU32(); index < count; index += 1) {
    headers.append(reader.readString(), reader.readString());
  }
  const body = reader.read(reader.readU32()).slice();
  reader.finish();

  const bodyAllowed = requestMethod !== "HEAD" && ![204, 205, 304].includes(status);
  return new Response(bodyAllowed ? body : null, { status, headers });
}

export async function handleRequest(createPicoRuby, wasmModule, appBytecode, request) {
  const module = await createPicoRuby({
    ...runtimeBindings,
    instantiateWasm(imports, success) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      success(instance, wasmModule);
      return instance.exports;
    },
  });

  if (module._picorb_worker_abi_version() !== ABI_VERSION) {
    throw new Error(`PicoRuby Worker ABI ${ABI_VERSION} is required`);
  }

  const bytecode = new Uint8Array(appBytecode);
  const bytecodePointer = copyToWasm(module, bytecode);
  try {
    const initialized = await module.ccall(
      "picorb_worker_init", "number", ["number", "number"],
      [bytecodePointer, bytecode.byteLength], { async: true },
    );
    if (initialized !== 0) throw new Error(`PicoRuby initialization failed: ${readError(module)}`);
  } finally {
    module._free(bytecodePointer);
  }

  try {
    const frame = await encodeRequest(request);
    const framePointer = copyToWasm(module, frame);
    try {
      const dispatched = await module.ccall(
        "picorb_worker_dispatch_v1", "number", ["number", "number"],
        [framePointer, frame.byteLength], { async: true },
      );
      if (dispatched !== 0) throw new Error(`PicoRuby dispatch failed: ${readError(module)}`);

      const responsePointer = module._picorb_worker_response_ptr();
      const responseLength = module._picorb_worker_response_len();
      return decodeResponse(module.HEAPU8.slice(responsePointer, responsePointer + responseLength), request.method);
    } finally {
      module._free(framePointer);
    }
  } finally {
    await module.ccall("picorb_worker_close", null, [], [], { async: true });
  }
}
