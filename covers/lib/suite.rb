module SinatraCovers
  class AssertionFailure < StandardError
  end

  class Scenario
    def initialize(client)
      @client = client
      @response = nil
    end

    def get(path)
      @response = @client.get(path)
    end

    def post(path, body:, headers: {})
      @response = @client.post(path, body: body, headers: headers)
    end

    def assert_status(expected)
      assert_equal(expected, response.status, "status")
    end

    def assert_header(name, expected)
      assert_equal(expected, response.headers[name.downcase], "header #{name.inspect}")
    end

    def assert_body(expected)
      assert_equal(expected, response.body, "body")
    end

    private

    def response
      @response || raise(AssertionFailure, "request has not been sent")
    end

    def assert_equal(expected, actual, label)
      return if expected == actual

      raise AssertionFailure, "#{label}: expected #{expected.inspect}, got #{actual.inspect}"
    end
  end

  class Suite
    def initialize(client)
      @client = client
      @failures = []
      @count = 0
    end

    def scenario(name, &block)
      @count += 1
      Scenario.new(@client).instance_eval(&block)
      puts "ok #{@count} - #{name}"
    rescue StandardError => error
      @failures << [name, error]
      puts "not ok #{@count} - #{name}"
      warn "  #{error.class}: #{error.message}"
    end

    def load_scenarios(path)
      ScenarioDefinitions.new(self).instance_eval(File.read(path), path, 1)
    end

    def finish!
      puts "1..#{@count}"
      return if @failures.empty?

      raise "#{@failures.length} of #{@count} compatibility scenarios failed"
    end
  end

  class ScenarioDefinitions
    def initialize(suite)
      @suite = suite
    end

    def scenario(name, &block)
      @suite.scenario(name, &block)
    end
  end
end
