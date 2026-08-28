# mattn/mruby-json loads this legacy absolute feature while evaluating its
# mrbgem.rake. PicoRuby keeps mruby under mrbgems/picoruby-mruby instead.
module PicoRubySinatraCoversBuild
  module MrubyJson
    module_function

    def enable_legacy_source_path
      legacy_source = File.join(MRUBY_ROOT, "lib", "mruby", "source.rb")
      return if File.file?(legacy_source)

      require "mruby/source"
      $LOADED_FEATURES << legacy_source unless $LOADED_FEATURES.include?(legacy_source)
    end
  end
end
