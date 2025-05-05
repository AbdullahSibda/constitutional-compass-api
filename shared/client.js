require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { AzureOpenAI } = require('openai');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_KEY   
);

// Initialize Azure OpenAI client (exact same config as SWA)
const openai = new AzureOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  deployment: "text-embedding-3-small",
  endpoint: process.env.OPENAI_API_URL,
  apiVersion: "2024-04-01-preview"
});

module.exports = { supabase, openai };