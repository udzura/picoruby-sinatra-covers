require_relative "../../lib/scenario_target"

backend_root = File.expand_path(__dir__)
runtime = File.join(backend_root, "dist", "picoruby-worker.wasm")
target = SinatraCovers::ScenarioTarget.from_environment
target.app_path
port = ENV.fetch("WORKER_PORT", "8787")

unless port.match?(/\A[1-9]\d{0,4}\z/) && port.to_i <= 65_535
  abort "WORKER_PORT must be an integer from 1 to 65535 (got #{port.inspect})."
end

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
exec({ "WORKER_PORT" => port }, "npm", "run", "dev")
