require_relative "lib/client"
require_relative "lib/suite"

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
Dir[File.expand_path("scenarios/*.rb", __dir__)].sort.each do |path|
  suite.load_scenarios(path)
end
suite.finish!
