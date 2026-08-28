scenario "generic error handler" do
  get "/errors/generic"
  assert_status 500
  assert_header "x-sinatra-error-handler", "generic"
  assert_header "x-sinatra-rescued-class", "RuntimeError"
  assert_body "generic: generic failure"
end

scenario "exception-specific error handler" do
  get "/errors/specific"
  assert_status 503
  assert_header "x-sinatra-error-handler", "specific"
  assert_header "x-sinatra-rescued-class", "SinatraCoversExpectedError"
  assert_body "specific: specific failure"
end
