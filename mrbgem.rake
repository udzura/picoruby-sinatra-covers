require_relative "build_support/mruby_json"

PicoRubySinatraCoversBuild::MrubyJson.enable_legacy_source_path

MRuby::Gem::Specification.new("picoruby-sinatra-covers") do |spec|
  spec.license = "MIT"
  spec.author = "Kondo Uchio"
  spec.summary = "Sinatra 4.2.1 compatibility cover for PicoRuby"
  spec.version = "0.1.0"

  sinatra_lib = File.join(dir, "vendor", "sinatra", "lib")
  base = File.join(sinatra_lib, "sinatra", "base.rb")

  unless File.file?(base)
    raise <<~MESSAGE
      Sinatra sources are missing.
      Run: git submodule update --init --recursive
    MESSAGE
  end

  spec.add_dependency "mruby-rack", github: "udzura/mruby-rack", branch: "master"
  spec.add_dependency "mruby-mustermann", github: "udzura/mruby-mustermann", branch: "master"
  spec.add_dependency "mruby-json",
                      github: "mattn/mruby-json",
                      branch: "master",
                      checksum_hash: "f99d9428025469f2400f93c53b185f65f963e507"

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
    spec.add_dependency name, gemdir: File.join(mruby_gems, name)
  end

  compat = %w[
    compat
    indifferent_hash
  ].map do |name|
    File.join(dir, "mrblib", "picoruby_sinatra_covers", "#{name}.rb")
  end

  spec.rbfiles = [
    File.join(sinatra_lib, "sinatra", "version.rb")
  ] + compat + [
    base,
    File.join(dir, "mrblib", "picoruby_sinatra_covers", "contrib", "json.rb"),
    File.join(dir, "mrblib", "picoruby_sinatra_covers", "defaults.rb")
  ]
end
