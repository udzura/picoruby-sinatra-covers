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

  conf.ports :worker_wasm
  conf.picoruby(alloc_estalloc: false)

  mruby_gems = File.join(MRUBY_ROOT, "mrbgems", "picoruby-mruby", "lib", "mruby", "mrbgems")
  %w[
    mruby-array-ext
    mruby-catch
    mruby-class-ext
    mruby-enum-ext
    mruby-hash-ext
    mruby-kernel-ext
    mruby-metaprog
    mruby-method
    mruby-numeric-ext
    mruby-object-ext
    mruby-proc-ext
    mruby-sprintf
    mruby-string-ext
    mruby-struct
    mruby-bin-mruby
    mruby-regexp
  ].each do |name|
    conf.gem gemdir: File.join(mruby_gems, name)
  end

  {
    "MRUBY_MUSTERMANN_GEM_DIR" => "udzura/mruby-mustermann",
    "MRUBY_RACK_GEM_DIR" => "udzura/mruby-rack",
    "PICORUBY_SINATRA_COVERS_GEM_DIR" => "udzura/picoruby-sinatra-covers",
  }.each do |environment, repository|
    if (gem_dir = ENV[environment])
      conf.gem gemdir: File.expand_path(gem_dir)
    else
      conf.gem github: repository, branch: "master"
    end
  end

  if (gem_dir = ENV["PICORUBY_WORKER_WASM_GEM_DIR"])
    conf.gem gemdir: File.expand_path(gem_dir)
  else
    conf.gem github: "udzura/picoruby-cloudflare-worker-wasm",
             branch: "0.2.2",
             checksum_hash: "939022a7d2c77acb3b2d456c8ebbcb54a17a9aca"
  end
end
