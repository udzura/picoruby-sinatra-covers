require "sinatra/json" unless RUBY_ENGINE == "mruby"

class SinatraCoversApp < Sinatra::Base
  set :sessions, false

  get "/covers/ready" do
    "ready"
  end

  get "/json/array" do
    json ["PicoRuby", 42, true, nil]
  end

  get "/json/content-type" do
    json ["custom"], content_type: "application/vnd.picoruby+json"
  end

  get "/json/to-json" do
    json({ name: "PicoRuby" }, json_encoder: :to_json)
  end
end

if RUBY_ENGINE == "mruby"
  Rackup::Handler::CloudflareWorker.run(SinatraCoversApp)
end
