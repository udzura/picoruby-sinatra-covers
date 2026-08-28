scenario "GET route" do
  get "/"
  assert_status 200
  assert_body "Sinatra 4.2.1"
end

scenario "named route parameter" do
  get "/hello/pico"
  assert_status 200
  assert_body "Hello, pico"
end

scenario "POST form parameters" do
  post "/add",
       body: "left=20&right=22",
       headers: { "content-type" => "application/x-www-form-urlencoded" }
  assert_status 200
  assert_body "42"
end

scenario "response status and header" do
  get "/created"
  assert_status 201
  assert_header "x-sinatra-covers", "true"
  assert_body "created"
end

scenario "not found" do
  get "/missing"
  assert_status 404
  assert_body "Not Found"
end
