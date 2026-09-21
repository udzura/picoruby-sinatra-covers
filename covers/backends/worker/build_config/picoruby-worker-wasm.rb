MRuby::CrossBuild.new("picoruby-worker-wasm") do |conf|
  conf.toolchain :clang

  conf.cc.command = "emcc"
  conf.linker.command = "emcc"
  conf.archiver.command = "emar"

  conf.cc.flags << "-sSUPPORT_LONGJMP=wasm"
  conf.cc.flags << "-sWASM_LEGACY_EXCEPTIONS=0"
  conf.linker.flags << "-sSUPPORT_LONGJMP=wasm"
  conf.linker.flags << "-sWASM_LEGACY_EXCEPTIONS=0"

  conf.cc.defines << "PICORB_PLATFORM_WASM"
  conf.cc.defines << "PICORB_PLATFORM_CLOUDFLARE_WORKERS"
  conf.cc.defines << "MRB_32BIT"
  conf.cc.defines << "MRB_INT64"
  conf.cc.defines << "MRB_NO_BOXING"
  conf.cc.defines << "MRB_UTF8_STRING"

  # Select the single-threaded HAL carried by picoruby-worker-wasm.
  conf.ports :worker_wasm
  conf.picoruby(alloc_estalloc: false)

  # PicoRuby keeps the mruby core gems in its VM submodule.
  mruby_gems = File.join(MRUBY_ROOT, "mrbgems", "picoruby-mruby", "lib", "mruby", "mrbgems")
  mruby_gems = File.join(MRUBY_ROOT, "mrbgems") unless File.directory?(mruby_gems)

  %w[
    mruby-array-ext
    mruby-catch
    mruby-class-ext
    mruby-enum-ext
    mruby-hash-ext
    mruby-kernel-ext
    mruby-metaprog
    mruby-pack
    mruby-method
    mruby-numeric-ext
    mruby-object-ext
    mruby-proc-ext
    mruby-regexp
    mruby-sprintf
    mruby-string-ext
    mruby-struct
  ].each do |name|
    conf.gem gemdir: File.join(mruby_gems, name)
  end

  conf.gem github: "udzura/picoruby-cloudflare-worker-wasm",
            branch: "master",
            checksum_hash: "ebab3afc4b06cdb29508de453795de90349c4691"

  if (gem_dir = ENV["PICORUBY_SINATRA_COVERS_GEM_DIR"])
    conf.gem gemdir: File.expand_path(gem_dir)
  else
    conf.gem github: "udzura/picoruby-sinatra-covers", branch: "master"
  end
end
