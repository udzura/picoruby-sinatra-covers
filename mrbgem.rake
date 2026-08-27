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

  spec.add_dependency "mruby-rack"
  spec.add_dependency "mruby-mustermann"

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
    spec.add_dependency name
  end

  compat = %w[
    compat
    indifferent_hash
  ].map do |name|
    File.join(dir, "mrblib", "picoruby_sinatra_covers", "#{name}.rb")
  end

  spec.rbfiles = compat + [
    File.join(sinatra_lib, "sinatra", "version.rb"),
    base,
    File.join(dir, "mrblib", "picoruby_sinatra_covers", "defaults.rb")
  ]
end
