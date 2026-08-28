project_root = File.expand_path("../../..", __dir__)
worker_root = ENV.fetch("PICORUBY_WORKER_ROOT") do
  File.expand_path("../picoruby-cloudflare-worker-wasm", project_root)
end
spike_root = File.join(worker_root, "spike")
runtime = File.join(spike_root, "dist", "picoruby-worker.wasm")

unless File.file?(File.join(spike_root, "package.json"))
  abort "PicoRuby Worker spike was not found: #{spike_root}"
end

unless File.file?(runtime)
  abort "Worker runtime was not built. Run `npm run build` in #{spike_root} first."
end

environment = {
  "PICORUBY_APP" => File.join(project_root, "covers", "basic_app.rb"),
  "PICORUBY_SINATRA_COVERS_GEM_DIR" => project_root,
}

Dir.chdir(spike_root)
exec(environment, "npm", "run", "dev")
