backend_root = File.expand_path(__dir__)
runtime = File.join(backend_root, "dist", "picoruby-worker.wasm")

unless File.file?(File.join(backend_root, "package.json"))
  abort "PicoRuby Worker backend was not found: #{backend_root}"
end

unless File.file?(runtime)
  abort "Worker runtime was not built. Run `rake -f #{File.join(backend_root, "Rakefile")} build` first."
end

Dir.chdir(backend_root)
exec("npm", "run", "dev")
