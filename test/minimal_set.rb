class Sinatra::Base
  def process_route(pattern, conditions, block = nil, values = [])
    route = @request.path_info
    route = '/' if route.empty? && !settings.empty_path_info?
    route = route[0..-2] if !settings.strict_paths? && route != '/' && route.end_with?('/')

    params = pattern.params(route)
    return unless params

    params.delete('ignore')
    force_encoding(params)
    @params = @params.merge(params) { |_k, v1, v2| v2 || v1 } if params.any?

    regexp_exists = pattern.is_a?(Mustermann::Regular) || (pattern.respond_to?(:patterns) && pattern.patterns.any? { |subpattern| subpattern.is_a?(Mustermann::Regular) })
    if regexp_exists
      captures = pattern.match(route).captures.map { |c| URI_INSTANCE.unescape(c) if c }
      values += captures
      @params[:captures] = force_encoding(captures) unless captures.nil? || captures.empty?
    else
      values += params.values.flatten
    end

    catch(:pass) do
      conditions.each { |c| throw :pass if c.bind(self).call == false }
      block ? block[self, values] : yield(self, values)
    end
  rescue StandardError
    @env['sinatra.error.params'] = @params
    raise
  ensure
    params = params || {}
    params.each { |k, _| @params.delete(k) } unless @env['sinatra.error.params']
  end
end

class ProbeInput
  def read
    ""
  end

  def rewind
    0
  end
end

class ProbeApp < Sinatra::Base
  get "/" do
    raise "boom"
  end
end

env = {
  "REQUEST_METHOD" => "GET",
  "SCRIPT_NAME" => "",
  "PATH_INFO" => "/",
  "QUERY_STRING" => "",
  "SERVER_NAME" => "example.com",
  "SERVER_PORT" => "80",
  "SERVER_PROTOCOL" => "HTTP/1.1",
  "HTTP_HOST" => "example.com",
  "CONTENT_TYPE" => "text/plain",
  "CONTENT_LENGTH" => "0",
  "rack.url_scheme" => "http",
  "rack.input" => ProbeInput.new,
  "rack.errors" => nil,
}

p ProbeApp.call(env)