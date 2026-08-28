class SinatraCoversExpectedError < StandardError
end

class SinatraCoversApp < Sinatra::Base
  set :sessions, false
  set :show_exceptions, false
  set :raise_errors, false
  set :dump_errors, false

  before do
    headers "content-type" => "text/plain; charset=utf-8"
  end

  get "/covers/ready" do
    "ready"
  end

  get "/errors/generic" do
    raise "generic failure"
  end

  get "/errors/specific" do
    raise SinatraCoversExpectedError, "specific failure"
  end

  error SinatraCoversExpectedError do
    error = env["sinatra.error"]
    status 503
    headers "x-sinatra-error-handler" => "specific"
    headers "x-sinatra-rescued-class" => error.class.to_s
    "specific: #{error.message}"
  end

  error do
    error = env["sinatra.error"]
    headers "x-sinatra-error-handler" => "generic"
    headers "x-sinatra-rescued-class" => error.class.to_s
    "generic: #{error.message}"
  end
end

if RUBY_ENGINE == "mruby"
  Rackup::Handler::CloudflareWorker.run(SinatraCoversApp)
end
