# Cloudflare Workers supplies the server and request isolation. The initial
# compatibility target intentionally excludes optional Sinatra middleware.
Sinatra::Base.set :environment, :production
Sinatra::Base.set :sessions, false
Sinatra::Base.set :session_secret, nil
Sinatra::Base.set :logging, nil
Sinatra::Base.set :protection, false
Sinatra::Base.set :host_authorization, {}
Sinatra::Base.set :method_override, false
Sinatra::Base.set :show_exceptions, false
Sinatra::Base.set :raise_errors, false
Sinatra::Base.set :dump_errors, false
Sinatra::Base.set :static, false
Sinatra::Base.set :reload_templates, false

class << Sinatra::Base
  private

  # Sinatra installs HostAuthorization independently of the protection flag.
  # The Worker adapter owns this boundary in the first compatibility target.
  def setup_host_authorization(_builder)
  end
end

Sinatra::Base.not_found do
  content_type "text/html"
  halt "<h1>Not Found</h1>"
end
