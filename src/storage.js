import { supabase } from "./supabaseClient.js";

// Shims the claude.ai artifact `window.storage` API with Supabase so the
// component can run unmodified outside the artifact sandbox. Backed by a
// single `kv_store` table (key text primary key, value text) — see
// supabase_schema.sql.
const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`No value for key: ${key}`);
    return { value: data.value };
  },
  async set(key, value) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return true;
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
