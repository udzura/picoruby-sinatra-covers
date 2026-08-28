require_relative "../../lib/scenario_target"

backend_root = File.expand_path(__dir__)
runtime = File.join(backend_root, "dist", "picoruby-worker.wasm")
target = SinatraCovers::ScenarioTarget.from_environment
target.app_path

unless File.file?(File.join(backend_root, "package.json"))
  abort "PicoRuby Worker backend was not found: #{backend_root}"
end

unless File.file?(runtime)
  abort "Worker runtime was not built. Run `rake -f #{File.join(backend_root, "Rakefile")} build` first."
end

Dir.chdir(backend_root)
unless system({ "COVER_SCENARIO" => target.name }, "rake", "-f", "Rakefile", "app")
  abort "Failed to compile Worker cover app: #{target.name}"
end
exec("npm", "run", "dev")
