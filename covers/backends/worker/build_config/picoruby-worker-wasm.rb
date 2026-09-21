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

  conf.gem gemdir: "#{ENV["PICORUBY_ROOT"]}/mrbgems/picoruby-mruby/lib/mruby/mrbgems/mruby-pack"

  conf.gem github: "udzura/picoruby-cloudflare-worker-wasm",
            branch: "master",
            checksum_hash: "ebab3afc4b06cdb29508de453795de90349c4691"
end
