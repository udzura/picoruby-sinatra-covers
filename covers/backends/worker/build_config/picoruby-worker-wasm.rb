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

  if (gem_dir = ENV["PICORUBY_SINATRA_COVERS_GEM_DIR"])
    conf.gem gemdir: File.expand_path(gem_dir)
  else
    conf.gem github: "udzura/picoruby-sinatra-covers", branch: "master"
  end

  # Register Sinatra's dependency sources first, then optional local overrides.
  %w[MRUBY_MUSTERMANN_GEM_DIR MRUBY_RACK_GEM_DIR].each do |environment|
    if (gem_dir = ENV[environment])
      conf.gem gemdir: File.expand_path(gem_dir)
    end
  end

  if (gem_dir = ENV["PICORUBY_WORKER_WASM_GEM_DIR"])
    conf.gem gemdir: File.expand_path(gem_dir)
  else
    conf.gem github: "udzura/picoruby-cloudflare-worker-wasm",
             branch: "master",
             checksum_hash: "b342a9a1952332cc8fa0e1c41eb4e458c3a8b0a9"
  end
end
