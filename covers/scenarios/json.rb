scenario "JSON helper encodes an array" do
  get "/json/array"
  assert_status 200
  assert_header "content-type", "application/json"
  assert_body '["PicoRuby",42,true,null]'
end

scenario "JSON helper accepts a custom content type" do
  get "/json/content-type"
  assert_status 200
  assert_header "content-type", "application/vnd.picoruby+json"
  assert_body '["custom"]'
end

scenario "JSON helper accepts a symbol encoder" do
  get "/json/to-json"
  assert_status 200
  assert_header "content-type", "application/json"
  assert_body '{"name":"PicoRuby"}'
end
