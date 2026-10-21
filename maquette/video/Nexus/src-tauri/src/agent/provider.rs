//! AI provider abstraction. Conversations are stored in Anthropic content-block
//! format (the canonical internal format); other providers translate at the edge.

use crate::secrets;
use crate::settings::Settings;
use anyhow::{anyhow, bail, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub struct ChatRequest<'a> {
    pub system: &'a str,
    pub messages: &'a [Value],
    pub tools: &'a [Value],
}

#[derive(Debug, Clone)]
pub struct ChatResponse {
    pub content: Vec<Value>,
    pub stop_reason: String,
    pub model: String,
    /// tool_use ids whose streamed input was not valid JSON, with the raw text.
    pub invalid_tool_inputs: Vec<(String, String)>,
    pub usage: Value,
}

pub enum Delta<'a> {
    Text(&'a str),
    ToolStart { id: &'a str, name: &'a str },
    Thinking,
}

/// Token usage of one or more requests, and an estimated price.
#[derive(Debug, Clone, Copy, Default)]
pub struct Usage {
    pub input: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub output: u64,
}

impl Usage {
    pub fn add(&mut self, v: &Value) {
        self.input += v["input_tokens"].as_u64().unwrap_or(0);
        self.cache_read += v["cache_read_input_tokens"].as_u64().unwrap_or(0);
        self.cache_write += v["cache_creation_input_tokens"].as_u64().unwrap_or(0);
        self.output += v["output_tokens"].as_u64().unwrap_or(0);
    }

    /// USD per million tokens (input, output) for known models; None if unknown.
    fn rates(model: &str) -> Option<(f64, f64)> {
        let m = model.to_lowercase();
        Some(if m.starts_with("claude-opus-5-5") {
            (4.0, 20.0)
        } else if m.starts_with("claude-opus") {
            (5.0, 25.0)
        } else if m.starts_with("claude-fable") || m.starts_with("claude-mythos") {
            (10.0, 50.0)
        } else if m.starts_with("claude-sonnet-5") {
            (2.0, 10.0)
        } else if m.starts_with("claude-sonnet") {
            (3.0, 15.0)
        } else if m.starts_with("claude-haiku") {
            (1.0, 5.0)
        } else {
            return None;
        })
    }

    /// Estimate: cache reads bill at 0.1x input, 5-minute cache writes at 1.25x.
    pub fn estimated_cost(&self, model: &str) -> Option<f64> {
        let (i, o) = Self::rates(model)?;
        Some((self.input as f64 * i + self.cache_read as f64 * i * 0.1 + self.cache_write as f64 * i * 1.25 + self.output as f64 * o) / 1_000_000.0)
    }

    pub fn describe(&self, model: &str) -> String {
        let cost = self.estimated_cost(model).map(|c| format!(" Â· â‰ˆ ${c:.3}")).unwrap_or_default();
        format!(
            "{} tokens in ({} from cache, {} written to cache), {} out{cost}",
            self.input + self.cache_read + self.cache_write,
            self.cache_read,
            self.cache_write,
            self.output
        )
    }
}

pub enum Provider {
    Anthropic { key: String, model: String, effort: String },
    OpenAi,
}

impl Provider {
    pub fn from_settings(s: &Settings) -> Result<Provider> {
        match s.ai_provider.as_str() {
            "anthropic" => {
                let key = secrets::get("anthropic_api_key")?.filter(|k| !k.is_empty()).ok_or_else(|| {
                    anyhow!("No Anthropic API key configured. Add it in Settings → AI (it is stored in Windows Credential Manager).")
                })?;
                Ok(Provider::Anthropic { key, model: s.anthropic_model.clone(), effort: s.effort.clone() })
            }
            "openai" => Ok(Provider::OpenAi),
            other => bail!("Unknown AI provider '{other}'"),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Provider::Anthropic { model, .. } => format!("Anthropic · {model}"),
            Provider::OpenAi => "OpenAI".into(),
        }
    }

    pub async fn chat(
        &self,
        http: &reqwest::Client,
        req: ChatRequest<'_>,
        cancel: &CancellationToken,
        on_delta: &mut (dyn FnMut(Delta) + Send),
    ) -> Result<ChatResponse> {
        match self {
            Provider::Anthropic { key, model, effort } => anthropic_chat(http, key, model, effort, req, cancel, on_delta).await,
            Provider::OpenAi => bail!(
                "The OpenAI provider is not implemented yet. The provider interface is ready for it; select Anthropic in Settings → AI for now."
            ),
        }
    }
}

fn supports_fallbacks(model: &str) -> bool {
    model.starts_with("claude-opus-5") || model.starts_with("claude-fable-5")
}

fn friendly_http_error(status: reqwest::StatusCode, body: &str) -> anyhow::Error {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect());
    match status.as_u16() {
        401 => anyhow!("Anthropic rejected the API key (401). Check it in Settings → AI. Details: {msg}"),
        403 => anyhow!("The API key is not allowed to use this model (403): {msg}"),
        404 => anyhow!("Model not found (404). Check the model name in Settings → AI: {msg}"),
        429 => anyhow!("Rate limited by Anthropic (429): {msg}"),
        529 => anyhow!("Anthropic is temporarily overloaded (529): {msg}"),
        _ => anyhow!("Anthropic API error {}: {msg}", status.as_u16()),
    }
}

async fn anthropic_chat(
    http: &reqwest::Client,
    key: &str,
    model: &str,
    effort: &str,
    req: ChatRequest<'_>,
    cancel: &CancellationToken,
    on_delta: &mut (dyn FnMut(Delta) + Send),
) -> Result<ChatResponse> {
    let mut body = json!({
        "model": model,
        "max_tokens": 32000,
        "stream": true,
        "system": [{"type": "text", "text": req.system, "cache_control": {"type": "ephemeral"}}],
        "cache_control": {"type": "ephemeral"},
        "messages": req.messages,
        "tools": req.tools,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": effort},
    });
    let mut betas = vec![];
    if supports_fallbacks(model) {
        body["fallbacks"] = json!("default");
        betas.push("server-side-fallback-2026-07-01");
    }

    // Retry only before any output has streamed: overload, rate limit, network.
    let mut attempt = 0;
    let resp = loop {
        attempt += 1;
        let mut rb = http
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .timeout(Duration::from_secs(600))
            .json(&body);
        if !betas.is_empty() {
            rb = rb.header("anthropic-beta", betas.join(","));
        }
        let r = tokio::select! {
            r = rb.send() => r,
            _ = cancel.cancelled() => bail!("Interrupted by STOP NEXUS"),
        };
        match r {
            Ok(r) if r.status().is_success() => break r,
            Ok(r) => {
                let status = r.status();
                let retry = matches!(status.as_u16(), 429 | 500 | 502 | 503 | 529);
                let text = r.text().await.unwrap_or_default();
                if !retry || attempt >= 3 {
                    return Err(friendly_http_error(status, &text));
                }
            }
            Err(e) if attempt < 3 && (e.is_connect() || e.is_timeout()) => {}
            Err(e) => bail!("Could not reach the Anthropic API: {e}"),
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(1500 * attempt)) => {}
            _ = cancel.cancelled() => bail!("Interrupted by STOP NEXUS"),
        }
    };

    let mut blocks: Vec<Value> = Vec::new();
    let mut partial_json: Vec<String> = Vec::new();
    let mut stop_reason = String::new();
    let mut model_used = model.to_string();
    let mut usage = json!({});
    let mut invalid = Vec::new();
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();

    loop {
        let chunk = tokio::select! {
            c = stream.next() => c,
            _ = cancel.cancelled() => bail!("Interrupted by STOP NEXUS"),
        };
        let Some(chunk) = chunk else { break };
        // Split on raw bytes: a chunk boundary can fall inside a multi-byte character.
        buf.extend(chunk.map_err(|e| anyhow!("Stream interrupted: {e}"))?.iter().filter(|b| **b != b'\r'));
        while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            let raw: Vec<u8> = buf.drain(..pos + 2).collect();
            let event = String::from_utf8_lossy(&raw);
            let data: String = event.lines().filter_map(|l| l.strip_prefix("data:")).map(|l| l.trim_start()).collect::<Vec<_>>().join("\n");
            if data.is_empty() {
                continue;
            }
            let v: Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match v["type"].as_str().unwrap_or("") {
                "message_start" => {
                    if let Some(m) = v["message"]["model"].as_str() {
                        model_used = m.to_string();
                    }
                    usage = v["message"]["usage"].clone();
                }
                "content_block_start" => {
                    let idx = v["index"].as_u64().unwrap_or(0) as usize;
                    let block = v["content_block"].clone();
                    while blocks.len() <= idx {
                        blocks.push(Value::Null);
                        partial_json.push(String::new());
                    }
                    match block["type"].as_str() {
                        Some("tool_use") => on_delta(Delta::ToolStart {
                            id: block["id"].as_str().unwrap_or(""),
                            name: block["name"].as_str().unwrap_or(""),
                        }),
                        Some("thinking") | Some("redacted_thinking") => on_delta(Delta::Thinking),
                        _ => {}
                    }
                    blocks[idx] = block;
                }
                "content_block_delta" => {
                    let idx = v["index"].as_u64().unwrap_or(0) as usize;
                    let d = &v["delta"];
                    let Some(b) = blocks.get_mut(idx) else { continue };
                    match d["type"].as_str().unwrap_or("") {
                        "text_delta" => {
                            let t = d["text"].as_str().unwrap_or("");
                            let cur = b["text"].as_str().unwrap_or("").to_string();
                            b["text"] = Value::String(cur + t);
                            on_delta(Delta::Text(t));
                        }
                        "thinking_delta" => {
                            let cur = b["thinking"].as_str().unwrap_or("").to_string();
                            b["thinking"] = Value::String(cur + d["thinking"].as_str().unwrap_or(""));
                        }
                        "signature_delta" => {
                            b["signature"] = d["signature"].clone();
                        }
                        "input_json_delta" => {
                            partial_json[idx].push_str(d["partial_json"].as_str().unwrap_or(""));
                        }
                        _ => {}
                    }
                }
                "content_block_stop" => {
                    let idx = v["index"].as_u64().unwrap_or(0) as usize;
                    if let Some(b) = blocks.get_mut(idx) {
                        if b["type"] == "tool_use" {
                            let raw = partial_json[idx].trim().to_string();
                            if raw.is_empty() {
                                b["input"] = json!({});
                            } else {
                                // Strict parse: eager streaming skips server-side validation.
                                match serde_json::from_str::<Value>(&raw) {
                                    Ok(inp) if inp.is_object() => b["input"] = inp,
                                    _ => {
                                        b["input"] = json!({});
                                        invalid.push((b["id"].as_str().unwrap_or("").to_string(), raw));
                                    }
                                }
                            }
                        }
                    }
                }
                "message_delta" => {
                    if let Some(sr) = v["delta"]["stop_reason"].as_str() {
                        stop_reason = sr.to_string();
                    }
                    // message_delta usage is cumulative and authoritative when present.
                    if let Some(u) = v["usage"].as_object() {
                        for (k, val) in u {
                            if val.is_u64() {
                                usage[k] = val.clone();
                            }
                        }
                    }
                }
                "error" => {
                    bail!("Anthropic stream error: {}", v["error"]["message"].as_str().unwrap_or("unknown error"));
                }
                _ => {}
            }
        }
    }
    if stop_reason.is_empty() {
        bail!("The response stream ended unexpectedly");
    }
    blocks.retain(|b| !b.is_null());
    Ok(ChatResponse { content: blocks, stop_reason, model: model_used, invalid_tool_inputs: invalid, usage })
}

#[cfg(test)]
mod tests {
    use super::Usage;
    use serde_json::json;

    #[test]
    fn usage_accumulates_and_prices_cache_reads_cheaply() {
        let mut u = Usage::default();
        u.add(&json!({"input_tokens": 1000, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 9000, "output_tokens": 200}));
        u.add(&json!({"input_tokens": 500, "cache_read_input_tokens": 10000, "cache_creation_input_tokens": 0, "output_tokens": 100}));
        assert_eq!((u.input, u.cache_read, u.cache_write, u.output), (1500, 10000, 9000, 300));
        let cached = u.estimated_cost("claude-sonnet-5").unwrap();
        let uncached = Usage { input: 20500, cache_read: 0, cache_write: 0, output: 300 }.estimated_cost("claude-sonnet-5").unwrap();
        assert!(cached < uncached, "{cached} vs {uncached}");
        assert!(u.estimated_cost("some-local-model").is_none());
    }
}
