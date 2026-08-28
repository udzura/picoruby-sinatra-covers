import createPicoRuby from "../dist/picoruby-worker.js";
import picoRubyWasm from "../dist/picoruby-worker.wasm";
import appBytecode from "../dist/app.bin";
import { handleRequest } from "./runtime.js";

export default {
  async fetch(request) {
    try {
      return await handleRequest(createPicoRuby, picoRubyWasm, appBytecode, request);
    } catch (error) {
      console.error(error);
      return new Response("PicoRuby Worker runtime error", { status: 500 });
    }
  },
};
