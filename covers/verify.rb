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
deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 30

loop do
  begin
    break if client.get("/covers/ready").status == 200
  rescue Errno::ECONNREFUSED, Errno::ECONNRESET, EOFError, Net::OpenTimeout
  end

  if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    abort "Server did not become ready at #{base_url}"
  end
  sleep 0.1
end

suite = SinatraCovers::Suite.new(client)
suite.load_scenarios(scenario_path)
suite.finish!
