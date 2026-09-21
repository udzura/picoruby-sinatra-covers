import {
  captureHostCall,
  captureHostCallSync,
  decodeHostCall,
  HostArgumentError,
  HostBindingError,
  HostProtocolError,
  HostResultKind,
  encodeHostResult,
  hostMissing,
  hostOk,
  utf8,
} from "./host-bridge.js";

const ABI_VERSION = 3;
const REQUEST_MAGIC = new Uint8Array([0x50, 0x52, 0x51, 0x31]); // PRQ1
const RESPONSE_MAGIC = new Uint8Array([0x50, 0x52, 0x52, 0x32]); // PRR2
const DEFAULT_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });
const missingEnvironmentValue = Symbol("missingEnvironmentValue");
const dispatchQueues = new WeakMap();
const hostContexts = new WeakMap();
const runtimeStreams = new WeakMap();

// A separate registry is created for every VM, even if callers reuse bindings.
export class HostStreamRegistry {
  constructor() {
    this.streams = new Map();
    this.nextId = 1;
  }

  register(stream) {
    if (!(stream instanceof ReadableStream) || stream.locked) {
      throw new HostProtocolError("Cloudflare AI streaming result must be an unlocked ReadableStream");
    }
    if (this.nextId > 0xffffffff) throw new HostProtocolError("Host stream handles exhausted");
    const id = this.nextId++;
    this.streams.set(id, stream);
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, id, true);
    return { kind: HostResultKind.hostStream, payload };
  }

  take(id) {
    const stream = this.streams.get(id);
    if (!stream) throw new HostProtocolError("Unknown or already transferred host stream handle");
    this.streams.delete(id);
    return stream;
  }

  discard() {
    for (const stream of this.streams.values()) {
      // Do not delay the response on an upstream cancellation promise.
      stream.cancel("Host stream was not returned").catch(() => {});
    }
    this.streams.clear();
  }
}

function responseStream(source, signal) {
  const reader = source.getReader();
  let finished = false;
  let controller;
  const finish = () => {
    finished = true;
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  };
  const cancel = (reason) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", abort);
    return reader.cancel(reason).catch(() => {}).finally(() => reader.releaseLock());
  };
  const abort = () => {
    if (finished) return;
    controller.error(signal.reason);
    void cancel(signal.reason);
  };
  return new ReadableStream({
    start(value) {
      controller = value;
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    },
    async pull() {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          controller.close();
          finish();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        if (finished) return;
        controller.error(error);
        finish();
      }
    },
    cancel,
  }, { highWaterMark: 0 });
}

export class RequestBodyTooLargeError extends Error {
  constructor(limit) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

async function unavailableHostBridge() {
  return await captureHostCall(async () => {
    throw new HostBindingError("PicoRuby Worker binding is not configured");
  });
}

function unavailableEnvironmentBridge() {
  return encodeHostResult(
    HostResultKind.bindingError,
    utf8("PicoRuby Worker environment binding is not configured"),
  );
}

const defaultRuntimeBindings = {
  picorbWorkerJspiAdd: async (left, right) => {
    await Promise.resolve();
    return left + right;
  },
  picorbWorkerHostCallBridge: unavailableHostBridge,
  picorbWorkerEnvGetBridge: unavailableEnvironmentBridge,
  picorbWorkerEnvBindingTypeBridge: unavailableEnvironmentBridge,
};

export function mergeBindings(...bindingSets) {
  const bindings = {};

  for (const bindingSet of bindingSets) {
    if (!bindingSet || typeof bindingSet !== "object" || Array.isArray(bindingSet)) {
      throw new TypeError("PicoRuby Worker bindings must be an object");
    }

    for (const [name, callback] of Object.entries(bindingSet)) {
      if (!name.startsWith("picorbWorker") || typeof callback !== "function") {
        throw new TypeError(`Invalid PicoRuby Worker binding: ${name}`);
      }
      if (Object.hasOwn(bindings, name)) {
        throw new Error(`Duplicate PicoRuby Worker binding: ${name}`);
      }
      bindings[name] = callback;
    }
  }

  return bindings;
}

export function createCloudflareKvBindings(env, bindingTypes = {}) {
  const types = normalizeBindingTypes(bindingTypes);
  const get = async (bindingName, key) => {
    const namespace = getKvNamespace(env, types, bindingName);
    const value = await namespace.get(decodeKvKey(key), "arrayBuffer");
    return value === null ? null : new Uint8Array(value);
  };

  const put = async (bindingName, key, value, options = {}) => {
    const namespace = getKvNamespace(env, types, bindingName);
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    await namespace.put(decodeKvKey(key), bytes.buffer, options);
  };

  return {
    picorbWorkerKvGetBridge: async (bindingName, key) => {
      return await captureHostCall(async () => {
        const value = await get(bindingName, key);
        return value === null ? hostMissing() : hostOk(value);
      });
    },
    picorbWorkerKvPutBridge: async (bindingName, key, value, optionsJson = "{}") => {
      return await captureHostCall(async () => {
        const options = parseKvPutOptions(optionsJson);
        await put(bindingName, key, value, options);
        return hostOk(new Uint8Array());
      });
    },
  };
}

function decodeKvKey(key) {
  if (typeof key === "string") return key;
  try {
    return strictDecoder.decode(key);
  } catch {
    throw new HostArgumentError("Cloudflare KV key must be valid UTF-8");
  }
}

function parseKvPutOptions(optionsJson) {
  let options;
  try {
    options = JSON.parse(optionsJson);
  } catch {
    throw new HostProtocolError("Cloudflare KV put options contain invalid JSON");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new HostArgumentError("Cloudflare KV put options must be a JSON object");
  }
  for (const name of Object.keys(options)) {
    if (name !== "ttl") throw new HostArgumentError(`Unknown Cloudflare KV put option: ${name}`);
  }
  if (!Object.hasOwn(options, "ttl")) return {};
  if (!Number.isSafeInteger(options.ttl) || options.ttl < 60) {
    throw new HostArgumentError("Cloudflare KV ttl must be a safe integer of at least 60 seconds");
  }
  return { expirationTtl: options.ttl };
}

export function createCloudflareQueueBindings(env, bindingTypes = {}) {
  const types = normalizeBindingTypes(bindingTypes);
  return {
    picorbWorkerQueueSendBridge: async (bindingName, message) => {
      return await captureHostCall(async () => {
        const queue = getQueue(env, types, bindingName);
        const body = decodeQueueMessage(message);
        await queue.send(body, { contentType: "text" });
        return hostOk(new Uint8Array());
      });
    },
  };
}

export function createCloudflareDurableObjectBindings(env, bindingTypes = {}) {
  const types = normalizeBindingTypes(bindingTypes);
  return {
    picorbWorkerDurableObjectGetBridge: async (bindingName, objectName) => {
      return await captureHostCall(async () => {
        const stub = getDurableObjectStub(env, types, bindingName, objectName);
        const json = await stub.get();
        if (json === null || json === undefined) return hostMissing();
        validateDurableObjectJson(json);
        return hostOk(utf8(json));
      });
    },
    picorbWorkerDurableObjectPutBridge: async (bindingName, objectName, json) => {
      return await captureHostCall(async () => {
        const stub = getDurableObjectStub(env, types, bindingName, objectName);
        validateDurableObjectJson(json);
        await stub.put(json);
        return hostOk(new Uint8Array());
      });
    },
  };
}

function getDurableObjectStub(env, bindingTypes, bindingName, objectName) {
  if (typeof bindingName !== "string" || bindingName.length === 0) {
    throw new HostArgumentError("Cloudflare Durable Object binding name must be a non-empty string");
  }
  if (typeof objectName !== "string" || objectName.length === 0) {
    throw new HostArgumentError("Cloudflare Durable Object name must be a non-empty string");
  }

  requireBindingType(bindingTypes, bindingName, "durable_object");
  const namespace = env[bindingName];
  if (!namespace || typeof namespace.getByName !== "function") {
    throw new HostBindingError(`Cloudflare Durable Object binding ${bindingName} is not configured`);
  }
  const stub = namespace.getByName(objectName);
  if (!stub || typeof stub.get !== "function" || typeof stub.put !== "function") {
    throw new HostBindingError(`Cloudflare Durable Object ${bindingName} does not provide get/put RPC methods`);
  }
  return stub;
}

function validateDurableObjectJson(json) {
  if (typeof json !== "string") {
    throw new HostProtocolError("Cloudflare Durable Object value must be a JSON string");
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new HostProtocolError("Cloudflare Durable Object value contains invalid JSON");
  }
  if (!value || typeof value !== "object") {
    throw new HostProtocolError("Cloudflare Durable Object value must encode a JSON object or array");
  }
}

export function createCloudflareD1Bindings(env, bindingTypes = {}) {
  const types = normalizeBindingTypes(bindingTypes);
  return {
    picorbWorkerD1Bridge: async (bindingName, requestJson) => {
      return await captureHostCall(async () => {
        const database = getD1Database(env, types, bindingName);
        const request = parseD1Request(requestJson);
        const result = await executeD1Request(database, request);
        validateJsonValue(result, "Cloudflare D1");
        return hostOk(utf8(JSON.stringify(result)));
      });
    },
  };
}

function getD1Database(env, bindingTypes, bindingName) {
  if (typeof bindingName !== "string" || bindingName.length === 0) {
    throw new HostArgumentError("Cloudflare D1 binding name must be a non-empty string");
  }

  requireBindingType(bindingTypes, bindingName, "d1");
  const database = env[bindingName];
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new HostBindingError(`Cloudflare D1 binding ${bindingName} is not configured`);
  }
  return database;
}

function parseD1Request(requestJson) {
  if (typeof requestJson !== "string") {
    throw new HostProtocolError("Cloudflare D1 request must be a JSON string");
  }
  let request;
  try {
    request = JSON.parse(requestJson);
  } catch {
    throw new HostProtocolError("Cloudflare D1 request contains invalid JSON");
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new HostProtocolError("Cloudflare D1 request must be an object");
  }

  if (request.operation === "batch") {
    requireD1Fields(request, ["operation", "statements"]);
    if (!Array.isArray(request.statements) || request.statements.length === 0) {
      throw new HostProtocolError("Cloudflare D1 batch requires at least one statement");
    }
    return {
      operation: "batch",
      statements: request.statements.map(validateD1StatementSpec),
    };
  }

  if (!["run", "first", "raw"].includes(request.operation)) {
    throw new HostProtocolError(`Unsupported Cloudflare D1 operation: ${request.operation}`);
  }
  const fields = ["operation", "sql", "params"];
  if (request.operation === "first") fields.push("column");
  if (request.operation === "raw") fields.push("columnNames");
  requireD1Fields(request, fields);

  const statement = validateD1StatementSpec({ sql: request.sql, params: request.params });
  if (request.operation === "first" && request.column !== null &&
      (typeof request.column !== "string" || request.column.length === 0)) {
    throw new HostProtocolError("Cloudflare D1 first column must be null or a non-empty string");
  }
  if (request.operation === "raw" && typeof request.columnNames !== "boolean") {
    throw new HostProtocolError("Cloudflare D1 raw columnNames must be boolean");
  }
  return { ...request, ...statement };
}

function requireD1Fields(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    throw new HostProtocolError("Cloudflare D1 request contains unsupported or missing fields");
  }
}

function validateD1StatementSpec(statement) {
  if (!statement || typeof statement !== "object" || Array.isArray(statement)) {
    throw new HostProtocolError("Cloudflare D1 statement must be an object");
  }
  requireD1Fields(statement, ["sql", "params"]);
  if (typeof statement.sql !== "string" || statement.sql.length === 0 || statement.sql.includes("\0")) {
    throw new HostArgumentError("Cloudflare D1 SQL must be a non-empty string without NUL bytes");
  }
  if (!Array.isArray(statement.params)) {
    throw new HostProtocolError("Cloudflare D1 params must be an array");
  }
  statement.params.forEach(validateD1Parameter);
  return { sql: statement.sql, params: statement.params };
}

function validateD1Parameter(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))) return;
  throw new HostArgumentError("Cloudflare D1 params must contain only JSON scalar values and safe integers");
}

function prepareD1Statement(database, spec) {
  let statement = database.prepare(spec.sql);
  if (!statement || typeof statement.run !== "function" || typeof statement.first !== "function" ||
      typeof statement.raw !== "function" || typeof statement.bind !== "function") {
    throw new HostBindingError("Cloudflare D1 prepare did not return a prepared statement");
  }
  if (spec.params.length > 0) statement = statement.bind(...spec.params);
  return statement;
}

async function executeD1Request(database, request) {
  if (request.operation === "batch") {
    return await database.batch(request.statements.map(spec => prepareD1Statement(database, spec)));
  }

  const statement = prepareD1Statement(database, request);
  if (request.operation === "run") return await statement.run();
  if (request.operation === "first") {
    return request.column === null ? await statement.first() : await statement.first(request.column);
  }
  return request.columnNames
    ? await statement.raw({ columnNames: true })
    : await statement.raw();
}

function validateJsonValue(value, label, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new HostProtocolError(`${label} returned a number outside the supported JSON range`);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    throw new HostProtocolError(`${label} returned a non-JSON value`);
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new HostProtocolError(`${label} returned a non-JSON object`);
  }
  if (ancestors.has(value)) {
    throw new HostProtocolError(`${label} returned a circular value`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => validateJsonValue(item, label, ancestors));
  } else {
    for (const item of Object.values(value)) validateJsonValue(item, label, ancestors);
  }
  ancestors.delete(value);
}

async function executeAiRun(env, bindingTypes, bindingName, model, inputJson, streams) {
  return await captureHostCall(async () => {
    if (typeof bindingName !== "string" || bindingName.length === 0) {
      throw new HostArgumentError("Cloudflare AI binding name must be a non-empty string");
    }
    if (typeof model !== "string" || model.length === 0 || model.includes("\0")) {
      throw new HostArgumentError("Cloudflare AI model must be a non-empty string without NUL bytes");
    }
    requireBindingType(bindingTypes, bindingName, "ai");
    const ai = env[bindingName];
    if (!ai || typeof ai.run !== "function") {
      throw new HostBindingError(`Cloudflare AI binding ${bindingName} is not configured`);
    }

    let input;
    try {
      input = JSON.parse(inputJson);
    } catch {
      throw new HostProtocolError("Cloudflare AI input contains invalid JSON");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new HostArgumentError("Cloudflare AI input must be a JSON object");
    }
    validateJsonValue(input, "Cloudflare AI input");

    const result = await ai.run(model, input);
    if (input.stream === true) return streams.register(result);
    validateJsonValue(result, "Cloudflare AI");
    return hostOk(utf8(JSON.stringify(result)));
  });
}

function parseVectorizeJson(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new HostProtocolError("Cloudflare Vectorize request contains invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HostArgumentError("Cloudflare Vectorize request must be a JSON object");
  }
  return value;
}

function getVectorizeIndex(env, bindingTypes, bindingName) {
  if (typeof bindingName !== "string" || bindingName.length === 0) {
    throw new HostArgumentError("Cloudflare Vectorize binding name must be a non-empty string");
  }
  requireBindingType(bindingTypes, bindingName, "vectorize");
  const index = env[bindingName];
  if (!index || typeof index.query !== "function") {
    throw new HostBindingError(`Cloudflare Vectorize binding ${bindingName} is not configured`);
  }
  return index;
}

function validateVector(values, label) {
  if (!Array.isArray(values) || values.length === 0 ||
      values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    throw new HostArgumentError(`${label} must be a non-empty Array of finite numbers`);
  }
}

function validateVectorizeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new HostArgumentError("Cloudflare Vectorize query options must be a JSON object");
  }
  const allowed = new Set(["topK", "returnValues", "returnMetadata", "namespace", "filter"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new HostArgumentError(`Unknown Cloudflare Vectorize query option: ${key}`);
  }
  if (!Number.isInteger(options.topK) || options.topK < 1 || options.topK > 100) {
    throw new HostArgumentError("Cloudflare Vectorize topK must be an Integer between 1 and 100");
  }
  if (typeof options.returnValues !== "boolean") {
    throw new HostArgumentError("Cloudflare Vectorize returnValues must be boolean");
  }
  if (!["none", "indexed", "all"].includes(options.returnMetadata)) {
    throw new HostArgumentError("Cloudflare Vectorize returnMetadata must be none, indexed, or all");
  }
  if ((options.returnValues || options.returnMetadata === "all") && options.topK > 50) {
    throw new HostArgumentError("Cloudflare Vectorize topK must not exceed 50 when returning values or all metadata");
  }
  if (options.namespace !== undefined &&
      (typeof options.namespace !== "string" || options.namespace.length === 0)) {
    throw new HostArgumentError("Cloudflare Vectorize namespace must be a non-empty string");
  }
  if (options.filter !== undefined &&
      (!options.filter || typeof options.filter !== "object" || Array.isArray(options.filter))) {
    throw new HostArgumentError("Cloudflare Vectorize filter must be a JSON object");
  }
  validateJsonValue(options, "Cloudflare Vectorize query options");
}

function validateVectorizeIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0 ||
      ids.some(id => typeof id !== "string" || id.length === 0)) {
    throw new HostArgumentError("Cloudflare Vectorize ids must be a non-empty Array of non-empty strings");
  }
}

function validateVectorizeVectors(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new HostArgumentError("Cloudflare Vectorize vectors must be a non-empty Array");
  }
  for (const vector of vectors) {
    if (!vector || typeof vector !== "object" || Array.isArray(vector) ||
        typeof vector.id !== "string" || vector.id.length === 0) {
      throw new HostArgumentError("Each Cloudflare Vectorize vector must have a non-empty string id");
    }
    validateVector(vector.values, "Cloudflare Vectorize vector values");
    if (vector.namespace !== undefined &&
        (typeof vector.namespace !== "string" || vector.namespace.length === 0)) {
      throw new HostArgumentError("Cloudflare Vectorize vector namespace must be a non-empty string");
    }
    if (vector.metadata !== undefined &&
        (!vector.metadata || typeof vector.metadata !== "object" || Array.isArray(vector.metadata))) {
      throw new HostArgumentError("Cloudflare Vectorize vector metadata must be a JSON object");
    }
    validateJsonValue(vector, "Cloudflare Vectorize vector");
  }
}

async function executeVectorize(env, bindingTypes, bindingName, operation, requestJson) {
  return await captureHostCall(async () => {
    const index = getVectorizeIndex(env, bindingTypes, bindingName);
    const request = parseVectorizeJson(requestJson);
    let result;
    if (operation === "query" || operation === "query_by_id") {
      validateVectorizeOptions(request.options);
      if (operation === "query") {
        validateVector(request.vector, "Cloudflare Vectorize query vector");
        result = await index.query(request.vector, request.options);
      } else {
        if (typeof request.id !== "string" || request.id.length === 0) {
          throw new HostArgumentError("Cloudflare Vectorize id must be a non-empty string");
        }
        if (typeof index.queryById !== "function") {
          throw new HostBindingError(`Cloudflare Vectorize binding ${bindingName} does not support queryById`);
        }
        result = await index.queryById(request.id, request.options);
      }
    } else if (operation === "insert" || operation === "upsert") {
      validateVectorizeVectors(request.vectors);
      if (typeof index[operation] !== "function") {
        throw new HostBindingError(`Cloudflare Vectorize binding ${bindingName} does not support ${operation}`);
      }
      result = await index[operation](request.vectors);
    } else if (operation === "get_by_ids" || operation === "delete_by_ids") {
      validateVectorizeIds(request.ids);
      const method = operation === "get_by_ids" ? "getByIds" : "deleteByIds";
      if (typeof index[method] !== "function") {
        throw new HostBindingError(`Cloudflare Vectorize binding ${bindingName} does not support ${method}`);
      }
      result = await index[method](request.ids);
    } else {
      if (typeof index.describe !== "function") {
        throw new HostBindingError(`Cloudflare Vectorize binding ${bindingName} does not support describe`);
      }
      result = await index.describe();
    }
    validateJsonValue(result, "Cloudflare Vectorize");
    return hostOk(utf8(JSON.stringify(result)));
  });
}

function decodeQueueMessage(message) {
  try {
    return strictDecoder.decode(message);
  } catch {
    throw new HostArgumentError("Cloudflare Queue message must be valid UTF-8");
  }
}

function getKvNamespace(env, bindingTypes, bindingName) {
  if (typeof bindingName !== "string" || bindingName.length === 0) {
    throw new HostArgumentError("Cloudflare KV binding name must be a non-empty string");
  }

  requireBindingType(bindingTypes, bindingName, "kv");
  const namespace = env[bindingName];
  if (!namespace || typeof namespace.get !== "function" || typeof namespace.put !== "function") {
    throw new HostBindingError(`Cloudflare KV binding ${bindingName} is not configured`);
  }
  return namespace;
}

function getQueue(env, bindingTypes, bindingName) {
  if (typeof bindingName !== "string" || bindingName.length === 0) {
    throw new HostArgumentError("Cloudflare Queue binding name must be a non-empty string");
  }

  requireBindingType(bindingTypes, bindingName, "queue");
  const queue = env[bindingName];
  if (!queue || typeof queue.send !== "function") {
    throw new HostBindingError(`Cloudflare Queue binding ${bindingName} is not configured`);
  }
  return queue;
}

function isJsonValue(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return true;
  return typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isResourceBinding(value) {
  return value && typeof value === "object" && (
    typeof value.get === "function" ||
    typeof value.put === "function" ||
    typeof value.send === "function" ||
    typeof value.run === "function" ||
    typeof value.query === "function" ||
    typeof value.prepare === "function" ||
    typeof value.fetch === "function" ||
    typeof value.getByName === "function"
  );
}

function readEnvironmentValue(env, key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new HostArgumentError("Environment variable name must be a non-empty string");
  }

  const value = env[key];
  if (value === undefined) return missingEnvironmentValue;
  if (typeof value === "string") return value;
  if (isResourceBinding(value)) return missingEnvironmentValue;
  if (isJsonValue(value)) return value;
  return missingEnvironmentValue;
}

function readBindingType(env, bindingTypes, key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new HostArgumentError("Cloudflare binding name must be a non-empty string");
  }

  return env[key] === undefined ? null : bindingTypes[key] ?? null;
}

export function createEnvironmentBindings(env, bindingTypes = {}) {
  const types = normalizeBindingTypes(bindingTypes);
  return {
    picorbWorkerEnvGetBridge: (key) => {
      return captureHostCallSync(() => {
        const value = readEnvironmentValue(env, key);
        return value === missingEnvironmentValue
          ? hostMissing()
          : hostOk(utf8(JSON.stringify(value)));
      });
    },
    picorbWorkerEnvBindingTypeBridge: (key) => {
      return captureHostCallSync(() => {
        const type = readBindingType(env, types, key);
        return type === null ? hostMissing() : hostOk(utf8(type));
      });
    },
  };
}

export function createFetchBindings(fetcher = (...args) => globalThis.fetch(...args)) {
  return {
    picorbWorkerFetchBridge: async (url, optionsJson = "{}") => captureHostCall(async () => {
      let options;
      try {
        options = JSON.parse(optionsJson);
      } catch {
        throw new HostProtocolError("Cloudflare fetch options contain invalid JSON");
      }
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new HostArgumentError("Cloudflare fetch options must be an object");
      }
      if (Object.keys(options).some(key => !["method", "headers", "body"].includes(key))) {
        throw new HostArgumentError("Cloudflare fetch options contain an unsupported field");
      }
      if (options.method !== undefined && typeof options.method !== "string") {
        throw new HostArgumentError("Cloudflare fetch method must be a string");
      }
      if (options.body !== undefined && typeof options.body !== "string") {
        throw new HostArgumentError("Cloudflare fetch body must be a string");
      }
      if (options.headers !== undefined && (!options.headers || typeof options.headers !== "object" ||
          Array.isArray(options.headers) || Object.values(options.headers).some(value => typeof value !== "string"))) {
        throw new HostArgumentError("Cloudflare fetch headers must be an object with string values");
      }
      let target;
      try {
        if (typeof url !== "string" || url.includes("\0")) throw new Error();
        target = new URL(url);
      } catch {
        throw new HostArgumentError("Cloudflare fetch URL must be a valid absolute URL without NUL bytes");
      }
      if (!["http:", "https:"].includes(target.protocol)) {
        throw new HostArgumentError("Cloudflare fetch URL must use HTTP or HTTPS");
      }
      if (target.username || target.password) {
        throw new HostArgumentError("Cloudflare fetch URL must not contain credentials");
      }
      let request;
      try {
        // workerd does not support redirect: "error". Reject redirects below instead.
        request = new Request(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(10000) });
      } catch {
        throw new HostArgumentError("Cloudflare fetch request construction failed; check method, headers and body compatibility");
      }
      let response;
      try {
        response = await fetcher(request);
      } catch {
        throw new Error("Cloudflare fetch network request failed or timed out");
      }
      if (response.status >= 300 && response.status < 400) {
        if (response.body) await response.body.cancel().catch(() => {});
        throw new Error(`Cloudflare fetch redirect response rejected (HTTP ${response.status})`);
      }
      let bytes;
      try {
        bytes = await readRequestBody(response, 1024 * 1024);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          throw new Error("Cloudflare fetch response body exceeds the 1 MiB limit");
        }
        throw new Error("Cloudflare fetch response body read failed or timed out");
      }
      let body;
      try {
        body = strictDecoder.decode(bytes);
      } catch {
        throw new HostProtocolError("Cloudflare fetch response body is not valid UTF-8");
      }
      return hostOk(utf8(JSON.stringify({
        status: response.status, headers: Object.fromEntries(response.headers), body,
      })));
    }),
  };
}

export function createCloudflareBindings(env, bindingTypes) {
  const streams = new HostStreamRegistry();
  const types = normalizeBindingTypes(bindingTypes);
  const operationBindings = mergeBindings(
    createCloudflareKvBindings(env, types),
    createCloudflareQueueBindings(env, types),
    createCloudflareDurableObjectBindings(env, types),
    createCloudflareD1Bindings(env, types),
    createFetchBindings(),
  );
  const operations = {
    "kv.get": ([key], bindingName) => operationBindings.picorbWorkerKvGetBridge(bindingName, key),
    "kv.put": ([key, value, options], bindingName) => operationBindings.picorbWorkerKvPutBridge(
      bindingName, key, value, decodeHostCallText(options),
    ),
    "queue.send": ([message], bindingName) => operationBindings.picorbWorkerQueueSendBridge(
      bindingName, message,
    ),
    "durable_object.get": ([name], bindingName) => operationBindings.picorbWorkerDurableObjectGetBridge(
      bindingName, decodeHostCallText(name),
    ),
    "durable_object.put": ([name, json], bindingName) => operationBindings.picorbWorkerDurableObjectPutBridge(
      bindingName, decodeHostCallText(name), decodeHostCallText(json),
    ),
    "d1.execute": ([request], bindingName) => operationBindings.picorbWorkerD1Bridge(
      bindingName, decodeHostCallText(request),
    ),
    "ai.run": ([model, input], bindingName) => executeAiRun(
      env, types, bindingName, decodeHostCallText(model), decodeHostCallText(input), streams,
    ),
    "vectorize.query": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "query", decodeHostCallText(request),
    ),
    "vectorize.query_by_id": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "query_by_id", decodeHostCallText(request),
    ),
    "vectorize.insert": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "insert", decodeHostCallText(request),
    ),
    "vectorize.upsert": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "upsert", decodeHostCallText(request),
    ),
    "vectorize.get_by_ids": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "get_by_ids", decodeHostCallText(request),
    ),
    "vectorize.delete_by_ids": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "delete_by_ids", decodeHostCallText(request),
    ),
    "vectorize.describe": ([request], bindingName) => executeVectorize(
      env, types, bindingName, "describe", decodeHostCallText(request),
    ),
    "fetch": ([url, options], bindingName) => {
      if (bindingName !== "") return protocolErrorFrame("Cloudflare fetch does not use a binding");
      return operationBindings.picorbWorkerFetchBridge(
        decodeHostCallText(url), decodeHostCallText(options),
      );
    },
  };
  const arities = {
    "kv.get": 1,
    "kv.put": 3,
    "queue.send": 1,
    "durable_object.get": 1,
    "durable_object.put": 2,
    "d1.execute": 1,
    "ai.run": 2,
    "vectorize.query": 1,
    "vectorize.query_by_id": 1,
    "vectorize.insert": 1,
    "vectorize.upsert": 1,
    "vectorize.get_by_ids": 1,
    "vectorize.delete_by_ids": 1,
    "vectorize.describe": 1,
    "fetch": 2,
  };
  const bindings = mergeBindings(
    {
      picorbWorkerHostCallBridge: async (frame) => {
        let call;
        try {
          call = decodeHostCall(frame);
        } catch (error) {
          return protocolErrorFrame(error instanceof Error ? error.message : String(error));
        }
        const operation = operations[call.operation];
        if (!operation) return protocolErrorFrame(`Unsupported Cloudflare host operation: ${call.operation}`);
        if (call.args.length !== arities[call.operation]) {
          return protocolErrorFrame(`Invalid argument count for Cloudflare host operation: ${call.operation}`);
        }
        try {
          return await operation(call.args, call.bindingName);
        } catch (error) {
          return protocolErrorFrame(error instanceof Error ? error.message : String(error));
        }
      },
    },
    createEnvironmentBindings(env, types),
  );
  hostContexts.set(bindings.picorbWorkerHostCallBridge, {
    streams,
    create: () => createCloudflareBindings(env, types),
  });
  return bindings;
}

function decodeHostCallText(bytes) {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    throw new HostProtocolError("Cloudflare host call text must be valid UTF-8");
  }
}

function protocolErrorFrame(message) {
  return encodeHostResult(HostResultKind.protocolError, utf8(message));
}

function normalizeBindingTypes(bindingTypes) {
  if (!bindingTypes || typeof bindingTypes !== "object" || Array.isArray(bindingTypes)) {
    throw new TypeError("Cloudflare binding types must be an object");
  }
  const normalized = Object.create(null);
  for (const [name, type] of Object.entries(bindingTypes)) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Cloudflare binding type contains an invalid name");
    }
    if (type !== "kv" && type !== "queue" && type !== "durable_object" &&
        type !== "d1" && type !== "ai" && type !== "vectorize") {
      throw new TypeError(`Unsupported Cloudflare binding type for ${name}: ${type}`);
    }
    normalized[name] = type;
  }
  return normalized;
}

function requireBindingType(bindingTypes, bindingName, expectedType) {
  const actualType = bindingTypes[bindingName];
  if (actualType === expectedType) return;
  if (actualType === undefined) {
    throw new HostBindingError(`Cloudflare binding ${bindingName} is not registered`);
  }
  throw new HostBindingError(`Cloudflare binding ${bindingName} is registered as ${actualType}, not ${expectedType}`);
}

class FrameWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
  }

  appendBytes(bytes) {
    this.parts.push(bytes);
    this.length += bytes.byteLength;
  }

  appendU32(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`Value cannot be encoded as u32: ${value}`);
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.appendBytes(bytes);
  }

  appendString(value) {
    this.appendLengthPrefixedBytes(encoder.encode(value));
  }

  appendLengthPrefixedBytes(bytes) {
    this.appendU32(bytes.byteLength);
    this.appendBytes(bytes);
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

  readBytes(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.frame.byteLength) {
      throw new Error("Truncated PicoRuby Worker response frame");
    }
    const bytes = this.frame.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readU32() {
    const bytes = this.readBytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  readString() {
    return decoder.decode(this.readBytes(this.readU32()));
  }

  finish() {
    if (this.offset !== this.frame.byteLength) {
      throw new Error("PicoRuby Worker response frame has trailing bytes");
    }
  }
}

function copyToWasm(module, bytes) {
  const size = Math.max(bytes.byteLength, 1);
  const pointer = module._malloc(size);
  if (pointer === 0) {
    throw new Error("PicoRuby Wasm allocation failed");
  }
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function readWasmString(module, pointer, length) {
  if (pointer === 0 || length === 0) return "";
  return decoder.decode(module.HEAPU8.subarray(pointer, pointer + length));
}

function readRuntimeError(module) {
  return readWasmString(
    module,
    module._picorb_worker_error_ptr(),
    module._picorb_worker_error_len(),
  );
}

async function readRequestBody(request, limit) {
  if (!request.body) return new Uint8Array();

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      throw new RequestBodyTooLargeError(limit);
    }
  }

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel("PicoRuby request body limit exceeded");
        throw new RequestBodyTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function encodeRackRequest(request, options = {}) {
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  const url = new URL(request.url);
  const scheme = url.protocol.slice(0, -1);
  const port = url.port || (scheme === "https" ? "443" : "80");
  const protocol = request.cf?.httpProtocol || "HTTP/1.1";
  const headers = Array.from(request.headers.entries());
  const body = await readRequestBody(request, maxRequestBodyBytes);

  const writer = new FrameWriter();
  writer.appendBytes(REQUEST_MAGIC);
  writer.appendString(request.method);
  writer.appendString(scheme);
  writer.appendString(url.hostname);
  writer.appendString(port);
  writer.appendString(url.host);
  writer.appendString(url.pathname || "/");
  writer.appendString(url.search.length > 0 ? url.search.slice(1) : "");
  writer.appendString(protocol);
  writer.appendU32(headers.length);
  for (const [name, value] of headers) {
    writer.appendString(name);
    writer.appendString(value);
  }
  writer.appendLengthPrefixedBytes(body);
  return writer.finish();
}

export function decodeRackResponse(frame, requestMethod = "GET", streams, signal) {
  const reader = new FrameReader(frame);
  const magic = reader.readBytes(RESPONSE_MAGIC.byteLength);
  for (let index = 0; index < RESPONSE_MAGIC.byteLength; index += 1) {
    if (magic[index] !== RESPONSE_MAGIC[index]) {
      throw new Error("Unsupported PicoRuby Worker response frame");
    }
  }

  const status = reader.readU32();
  const headerCount = reader.readU32();
  if (status < 200 || status > 599 || headerCount > 1024) {
    throw new Error("Invalid PicoRuby Worker response frame metadata");
  }

  const headers = new Headers();
  for (let index = 0; index < headerCount; index += 1) {
    headers.append(reader.readString(), reader.readString());
  }
  const mode = reader.readU32();
  if (mode !== 0 && mode !== 1) throw new Error("Unknown PicoRuby response body mode");
  const bodyData = mode === 0 ? reader.readBytes(reader.readU32()).slice() : reader.readU32();
  reader.finish();

  const bodyAllowed = requestMethod !== "HEAD" && status !== 204 && status !== 205 && status !== 304;
  if (mode === 0) return new Response(bodyAllowed ? bodyData : null, { status, headers });
  if (!streams) throw new Error("Host stream registry is unavailable");
  // A streaming length is unknown, and transport framing belongs to Workers.
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const source = streams.take(bodyData);
  if (!bodyAllowed) {
    source.cancel("Response does not permit a body").catch(() => {});
    return new Response(null, { status, headers });
  }
  const body = responseStream(source, signal);
  try {
    return new Response(body, { status, headers });
  } catch (error) {
    body.cancel(error).catch(() => {});
    throw error;
  }
}

export async function createRuntime(createPicoRuby, wasmModule, appBytecode, runtimeBindings = {}) {
  const bindings = mergeBindings(runtimeBindings);
  const context = hostContexts.get(bindings.picorbWorkerHostCallBridge);
  if (context) {
    bindings.picorbWorkerHostCallBridge = context.create().picorbWorkerHostCallBridge;
  }
  const streams = hostContexts.get(bindings.picorbWorkerHostCallBridge)?.streams;
  const module = await createPicoRuby({
    ...defaultRuntimeBindings,
    ...bindings,
    instantiateWasm(imports, successCallback) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      successCallback(instance, wasmModule);
      return instance.exports;
    },
  });

  runtimeStreams.set(module, streams);
  const actualAbiVersion = module._picorb_worker_abi_version();
  if (actualAbiVersion !== ABI_VERSION) {
    throw new Error(`PicoRuby Worker ABI ${ABI_VERSION} is required (found ${actualAbiVersion})`);
  }

  const bytecode = new Uint8Array(appBytecode);
  const pointer = copyToWasm(module, bytecode);
  try {
    const status = await module.ccall(
      "picorb_worker_init",
      "number",
      ["number", "number"],
      [pointer, bytecode.byteLength],
      { async: true },
    );
    if (status !== 0) {
      throw new Error(`PicoRuby initialization failed: ${readRuntimeError(module)}`);
    }
  } catch (error) {
    streams?.discard();
    await closeRuntime(module);
    throw error;
  } finally {
    module._free(pointer);
  }
  return module;
}

export async function closeRuntime(module) {
  const pendingDispatch = dispatchQueues.get(module);
  if (pendingDispatch) await pendingDispatch.catch(() => {});

  runtimeStreams.get(module)?.discard();
  await module.ccall(
    "picorb_worker_close",
    null,
    [],
    [],
    { async: true },
  );
}

export async function handleRequest(
  createPicoRuby,
  wasmModule,
  appBytecode,
  request,
  ...bindingSets
) {
  const bindings = mergeBindings(...bindingSets);
  const module = await createRuntime(createPicoRuby, wasmModule, appBytecode, bindings);
  try {
    return await dispatch(module, request);
  } finally {
    await closeRuntime(module);
  }
}

export function dispatch(module, request, requestOptions = {}) {
  const previousDispatch = dispatchQueues.get(module) ?? Promise.resolve();
  const currentDispatch = previousDispatch
    .catch(() => {})
    .then(() => dispatchOnce(module, request, requestOptions));
  dispatchQueues.set(module, currentDispatch);

  return currentDispatch.finally(() => {
    if (dispatchQueues.get(module) === currentDispatch) {
      dispatchQueues.delete(module);
    }
  });
}

async function dispatchOnce(module, request, requestOptions) {
  const frame = await encodeRackRequest(request, requestOptions);
  const pointer = copyToWasm(module, frame);
  try {
    const status = await module.ccall(
      "picorb_worker_dispatch_v1",
      "number",
      ["number", "number"],
      [pointer, frame.byteLength],
      { async: true },
    );
    if (status !== 0) {
      throw new Error(`PicoRuby dispatch failed: ${readRuntimeError(module)}`);
    }

    const responsePointer = module._picorb_worker_response_ptr();
    const responseLength = module._picorb_worker_response_len();
    const responseFrame = module.HEAPU8.slice(responsePointer, responsePointer + responseLength);
    return decodeRackResponse(responseFrame, request.method, runtimeStreams.get(module), request.signal);
  } finally {
    runtimeStreams.get(module)?.discard();
    module._free(pointer);
  }
}
