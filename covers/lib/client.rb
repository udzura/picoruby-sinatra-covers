require "net/http"
require "uri"

module SinatraCovers
  Response = Struct.new(:status, :headers, :body)

  class Client
    def initialize(base_url)
      @base_url = base_url.sub(%r{/+\z}, "")
    end

    def get(path)
      request(Net::HTTP::Get, path)
    end

    def post(path, body:, headers: {})
      request(Net::HTTP::Post, path, body: body, headers: headers)
    end

    private

    def request(request_class, path, body: nil, headers: {})
      uri = URI.parse("#{@base_url}#{path}")
      request = request_class.new(uri)
      headers.each { |name, value| request[name] = value }
      request.body = body if body

      response = Net::HTTP.start(
        uri.hostname,
        uri.port,
        use_ssl: uri.scheme == "https",
        open_timeout: 1,
        read_timeout: 5,
      ) { |http| http.request(request) }

      response_headers = {}
      response.each_header { |name, value| response_headers[name.downcase] = value }
      Response.new(response.code.to_i, response_headers, response.body || "")
    end
  end
end
