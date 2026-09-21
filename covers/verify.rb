require_relative "lib/client"
require_relative "lib/scenario_target"
require_relative "lib/suite"

scenario_name = ARGV.shift || ENV["COVER_SCENARIO"]
abort "Usage: ruby covers/verify.rb SCENARIO" unless scenario_name
abort "Unexpected arguments: #{ARGV.join(" ")}" unless ARGV.empty?

begin
  target = SinatraCovers::ScenarioTarget.new(scenario_name)
  scenario_path = target.scenario_path
rescue ArgumentError => error
  abort error.message
end

base_url = ENV.fetch("BASE_URL")
client = SinatraCovers::Client.new(base_url)
ready_timeout = Integer(ENV.fetch("SERVER_READY_TIMEOUT", "90"), 10)
abort "SERVER_READY_TIMEOUT must be positive" unless ready_timeout.positive?
started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
deadline = started_at + ready_timeout
next_progress_at = 10

loop do
  begin
    break if client.get("/covers/ready").status == 200
  rescue Errno::ECONNREFUSED, Errno::ECONNRESET, EOFError, Net::OpenTimeout
  end

  elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at
  if elapsed >= next_progress_at
    warn "Waiting for #{base_url} (#{elapsed.round}s/#{ready_timeout}s)"
    next_progress_at += 10
  end

  if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    worker_log = File.expand_path("backends/worker/tmp/worker.log", __dir__)
    details = if File.file?(worker_log)
      File.readlines(worker_log).last(200).join
    else
      "Worker startup log was not created: #{worker_log}\n"
    end
    abort "Server did not become ready at #{base_url} after #{ready_timeout}s.\n\nWorker startup log (#{worker_log}):\n#{details}"
  end
  sleep 0.1
end

suite = SinatraCovers::Suite.new(client)
suite.load_scenarios(scenario_path)
suite.finish!
