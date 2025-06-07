-- Create API keys table for managing third-party integrations
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  key VARCHAR(255) UNIQUE NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
  created_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used TIMESTAMP WITH TIME ZONE,
  usage_count INTEGER DEFAULT 0,
  rate_limit INTEGER DEFAULT 1000, -- requests per hour
  allowed_ips TEXT[] DEFAULT '{}', -- IP whitelist
  metadata JSONB DEFAULT '{}'
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);

-- Create API usage logs table for monitoring and analytics
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  response_time INTEGER, -- in milliseconds
  ip_address INET,
  user_agent TEXT,
  request_size INTEGER,
  response_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_api_key_id ON api_usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_endpoint ON api_usage_logs(endpoint);

-- Create webhook endpoints table
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  url VARCHAR(500) NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}', -- array of event types to listen for
  secret VARCHAR(255), -- for webhook signature verification
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'failed')),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_success TIMESTAMP WITH TIME ZONE,
  last_failure TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT
);

-- Create index for webhook lookups
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_api_key_id ON webhook_endpoints(api_key_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_status ON webhook_endpoints(status);

-- Create webhook delivery logs table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  webhook_endpoint_id UUID REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  http_status INTEGER,
  response_body TEXT,
  attempt_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  next_retry TIMESTAMP WITH TIME ZONE
);

-- Create indexes for webhook delivery tracking
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_endpoint_id ON webhook_deliveries(webhook_endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for API keys (only admins and super_admins can manage)
CREATE POLICY "Admins can manage API keys" ON api_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Create RLS policies for API usage logs (read-only for admins)
CREATE POLICY "Admins can view API usage logs" ON api_usage_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Create RLS policies for webhook endpoints
CREATE POLICY "Admins can manage webhook endpoints" ON webhook_endpoints
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Create RLS policies for webhook deliveries
CREATE POLICY "Admins can view webhook deliveries" ON webhook_deliveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Create function to update last_used timestamp when API key is used
CREATE OR REPLACE FUNCTION update_api_key_usage(key_value TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE api_keys 
  SET 
    last_used = NOW(),
    usage_count = usage_count + 1
  WHERE key = key_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to log API usage
CREATE OR REPLACE FUNCTION log_api_usage(
  key_value TEXT,
  endpoint_path VARCHAR(255),
  http_method VARCHAR(10),
  status_code INTEGER,
  response_time INTEGER DEFAULT NULL,
  ip_address INET DEFAULT NULL,
  user_agent TEXT DEFAULT NULL,
  request_size INTEGER DEFAULT NULL,
  response_size INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  key_id UUID;
BEGIN
  -- Get the API key ID
  SELECT id INTO key_id FROM api_keys WHERE key = key_value;
  
  IF key_id IS NOT NULL THEN
    -- Log the usage
    INSERT INTO api_usage_logs (
      api_key_id,
      endpoint,
      method,
      status_code,
      response_time,
      ip_address,
      user_agent,
      request_size,
      response_size
    ) VALUES (
      key_id,
      endpoint_path,
      http_method,
      status_code,
      response_time,
      ip_address,
      user_agent,
      request_size,
      response_size
    );
    
    -- Update API key usage
    PERFORM update_api_key_usage(key_value);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
