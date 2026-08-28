def assert(condition, message)
  raise "assertion failed: #{message}" unless condition
end

class Input
  def initialize(data = "")
    @data = data
    @offset = 0
  end

  def read
    value = @data[@offset..-1] || ""
    @offset = @data.bytesize
    value
  end

  def rewind
    @offset = 0
    0
  end
end

class CoveredApp < Sinatra::Base
  get "/" do
    "Sinatra #{Sinatra::VERSION} on PicoRuby"
  end

  get "/hello/:name" do
    "Hello, #{params[:name]}"
  end

  post "/add" do
    (params[:left].to_i + params[:right].to_i).to_s
  end

  get "/json" do
    json ["PicoRuby", 42, true, nil]
  end

  get "/json/to-json" do
    json({ name: "PicoRuby" }, json_encoder: :to_json)
  end
end

def request(app, method, path, query = "", body = "")
  app.call(
    "REQUEST_METHOD" => method,
    "SCRIPT_NAME" => "",
    "PATH_INFO" => path,
    "QUERY_STRING" => query,
    "SERVER_NAME" => "example.com",
    "SERVER_PORT" => "443",
    "SERVER_PROTOCOL" => "HTTP/1.1",
    "HTTP_HOST" => "example.com",
    "CONTENT_TYPE" => "application/x-www-form-urlencoded",
    "CONTENT_LENGTH" => body.bytesize.to_s,
    "rack.url_scheme" => "https",
    "rack.input" => Input.new(body),
    "rack.errors" => nil
  )
end

status, headers, body = request(CoveredApp, "GET", "/")
assert(status == 200, "root status")
assert(headers["content-type"] == "text/html;charset=utf-8", "default content type")
assert(body == ["Sinatra 4.2.1 on PicoRuby"], "root response")

status, _headers, body = request(CoveredApp, "GET", "/hello/pico")
assert(status == 200, "named route status")
assert(body == ["Hello, pico"], "Mustermann params")

status, _headers, body = request(CoveredApp, "POST", "/add", "", "left=20&right=22")
assert(status == 200, "post route status")
assert(body == ["42"], "form params")

status, headers, body = request(CoveredApp, "GET", "/json")
assert(status == 200, "json route status")
assert(headers["content-type"] == "application/json", "json content type")
assert(body == ['["PicoRuby",42,true,null]'], "json response")

status, headers, body = request(CoveredApp, "GET", "/json/to-json")
assert(status == 200, "json symbol encoder status")
assert(headers["content-type"] == "application/json", "json symbol encoder content type")
assert(body == ['{"name":"PicoRuby"}'], "json symbol encoder response")

status, _headers, body = request(CoveredApp, "GET", "/missing")
assert(status == 404, "missing route status")
assert(body == ["<h1>Not Found</h1>"], "missing route response")

assert(CoveredApp.sessions == false, "sessions remain disabled")
puts "picoruby-sinatra-covers smoke: PASS"
