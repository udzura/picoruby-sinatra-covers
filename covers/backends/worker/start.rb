require "fileutils"
require_relative "../../lib/scenario_target"

backend_root = File.expand_path(__dir__)
runtime = File.join(backend_root, "dist", "picoruby-worker.wasm")
log_path = File.join(backend_root, "tmp", "worker.log")
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

FileUtils.mkdir_p(File.dirname(log_path))
log = File.open(log_path, "w")
log.sync = true

def worker_log(log, message)
  line = "[worker-cover] #{message}"
  warn line
  log.puts line
end

worker_log(log, "scenario=#{target.name} port=#{port}")
worker_log(log, "backend_root=#{backend_root}")
worker_log(log, "runtime=#{runtime} bytes=#{File.size(runtime)}")

Dir.chdir(backend_root)
worker_log(log, "compiling app=#{target.app_path}")
unless system({ "COVER_SCENARIO" => target.name }, "rake", "-f", "Rakefile", "app")
  worker_log(log, "app compilation failed with exit status #{$?.exitstatus}")
  abort "Failed to compile Worker cover app: #{target.name}"
end

app = File.join(backend_root, "dist", "app.bin")
worker_log(log, "app=#{app} bytes=#{File.size(app)}")
worker_log(log, "launching npm run dev with WORKER_PORT=#{port}; log=#{log_path}")
exec({ "WORKER_PORT" => port }, "npm", "run", "dev", out: [log_path, "a"], err: [:child, :out])
