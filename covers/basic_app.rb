class SinatraCoversApp < Sinatra::Base
  set :sessions, false

  before do
    headers "content-type" => "text/plain; charset=utf-8"
  end

  get "/covers/ready" do
    "ready"
  end

  get "/" do
    "Sinatra #{Sinatra::VERSION}"
  end

  get "/hello/:name" do
    "Hello, #{params[:name]}"
  end

  post "/add" do
    (params[:left].to_i + params[:right].to_i).to_s
  end

  get "/created" do
    status 201
    headers "x-sinatra-covers" => "true"
    "created"
  end

  not_found do
    "Not Found"
  end
end

if RUBY_ENGINE == "mruby"
  Rackup::Handler::CloudflareWorker.run(SinatraCoversApp)
end
