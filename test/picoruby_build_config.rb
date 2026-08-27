MRuby::Build.new("picoruby-sinatra-covers-test") do |conf|
  conf.toolchain :clang

  conf.cc.defines << "PICORB_PLATFORM_POSIX"
  conf.cc.defines << "MRB_INT64"
  conf.cc.defines << "MRB_NO_BOXING"
  conf.cc.defines << "MRB_UTF8_STRING"

  conf.picoruby(alloc_estalloc: false)
  conf.gem core: "mruby-bin-mrbc"

  mruby_gems = File.join(
    MRUBY_ROOT,
    "mrbgems",
    "picoruby-mruby",
    "lib",
    "mruby",
    "mrbgems"
  )

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
  ].each do |name|
    conf.gem gemdir: File.join(mruby_gems, name)
  end

  conf.gem gemdir: File.expand_path(ENV.fetch("MRUBY_REGEXP_DIR"))
  conf.gem gemdir: File.join(mruby_gems, "mruby-bin-mruby")
  conf.gem gemdir: ENV.fetch("MRUBY_MUSTERMANN_ROOT")
  conf.gem gemdir: ENV.fetch("MRUBY_RACK_ROOT")
  conf.gem gemdir: ENV.fetch("PICORUBY_SINATRA_COVERS_ROOT")
end
