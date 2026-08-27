require "rake"
require "fileutils"

PROJECT_ROOT = File.expand_path(__dir__)

def picoruby_root
  candidates = [
    ENV["PICORUBY_ROOT"],
    File.expand_path("../../picoruby/picoruby", PROJECT_ROOT)
  ].compact

  root = candidates.find { |candidate| File.file?(File.join(candidate, "Rakefile")) }
  return root if root

  abort "Set PICORUBY_ROOT to a PicoRuby checkout"
end

def sibling_project(name, environment_key)
  candidate = ENV[environment_key] || File.expand_path("../#{name}", PROJECT_ROOT)
  return candidate if File.file?(File.join(candidate, "mrbgem.rake"))

  abort "Set #{environment_key} to the #{name} checkout"
end

def prepare_mruby_regexp(root, mustermann_root)
  source = File.join(
    root,
    "mrbgems",
    "picoruby-mruby",
    "lib",
    "mruby",
    "mrbgems",
    "mruby-regexp"
  )
  destination = File.join(PROJECT_ROOT, "tmp", "mruby-regexp")
  patch = File.join(mustermann_root, "patches", "mruby-regexp-7257.patch")
  stamp = File.join(destination, ".patched-7257")

  if File.file?(stamp) && File.mtime(stamp) >= File.mtime(patch)
    return destination
  end

  FileUtils.rm_rf(destination)
  FileUtils.mkdir_p(File.dirname(destination))
  FileUtils.cp_r(source, destination)
  sh "patch", "-d", destination, "-p1", "-i", patch
  FileUtils.touch(stamp)
  destination
end

desc "Build PicoRuby with Sinatra 4.2.1 and run the smoke test"
task :test do
  root = picoruby_root
  mustermann_root = sibling_project("mruby-mustermann", "MRUBY_MUSTERMANN_ROOT")
  rack_root = sibling_project("mruby-rack", "MRUBY_RACK_ROOT")
  regexp_dir = ENV["MRUBY_REGEXP_DIR"] || prepare_mruby_regexp(root, mustermann_root)
  env = {
    "MRUBY_CONFIG" => File.join(PROJECT_ROOT, "test", "picoruby_build_config.rb"),
    "MRUBY_MUSTERMANN_ROOT" => mustermann_root,
    "MRUBY_RACK_ROOT" => rack_root,
    "MRUBY_REGEXP_DIR" => regexp_dir,
    "PICORUBY_SINATRA_COVERS_ROOT" => PROJECT_ROOT
  }

  Dir.chdir(root) { sh env, "rake" }
  executable = File.join(root, "build", "picoruby-sinatra-covers-test", "bin", "mruby")
  sh executable, File.join(PROJECT_ROOT, "test", "smoke.rb")
end

task default: :test
