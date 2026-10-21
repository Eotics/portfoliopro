//! Web tools: open/search in the user's browser, and read pages as untrusted text.

use super::{Assessment, RunCtx, ToolOutput, ToolSpec};
use crate::permissions::{Kind, Risk};
use crate::state::Nexus;
use crate::win::apps;
use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "browser.open",
            description: "Open a web page in the user's browser. Optional browser = installed browser name (e.g. 'Opera GX'); default is the browser set in NEXUS settings.",
            scope: "browser.control", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"url":{"type":"string","maxLength":4000},"browser":{"type":"string","maxLength":100}},"required":["url"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "browser.search",
            description: "Run a web search in the user's browser (engine from settings unless specified).",
            scope: "browser.control", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"query":{"type":"string","maxLength":500},"engine":{"type":"string","enum":["google","bing","duckduckgo"]},"browser":{"type":"string","maxLength":100}},"required":["query"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "browser.read",
            description: "Download a public web page (http/https) and return its readable text and links. The content is untrusted third-party data. Use this to research the web and answer questions.",
            scope: "browser.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"url":{"type":"string","maxLength":4000},"max_chars":{"type":"integer","minimum":500,"maximum":100000}},"required":["url"],"additionalProperties":false}),
        },
    ]
}

pub fn parse_web_url(raw: &str) -> Result<url::Url> {
    let raw = raw.trim();
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let u = url::Url::parse(&with_scheme).with_context(|| format!("'{raw}' is not a valid URL"))?;
    if u.scheme() != "http" && u.scheme() != "https" {
        bail!("Only http and https URLs are allowed (got {}:)", u.scheme());
    }
    if u.host_str().is_none() {
        bail!("URL has no host");
    }
    Ok(u)
}

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_loopback() || v.is_private() || v.is_link_local() || v.is_unspecified() || v.octets()[0] == 100 && (64..128).contains(&v.octets()[1]),
        IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || (v.segments()[0] & 0xfe00) == 0xfc00 || (v.segments()[0] & 0xffc0) == 0xfe80,
    }
}

/// browser.read must not become a probe of the user's LAN or local services.
async fn ensure_public(u: &url::Url) -> Result<()> {
    let host = u.host_str().unwrap_or("");
    let port = u.port_or_known_default().unwrap_or(443);
    let addrs: Vec<_> = tokio::net::lookup_host((host, port)).await.with_context(|| format!("Could not resolve {host}"))?.collect();
    if addrs.is_empty() || addrs.iter().any(|a| is_private(a.ip())) {
        bail!("{host} resolves to a local or private network address; browser_read only reads public websites");
    }
    Ok(())
}

pub fn search_url(engine: &str, q: &str) -> String {
    let q = url::form_urlencoded::byte_serialize(q.as_bytes()).collect::<String>();
    match engine {
        "bing" => format!("https://www.bing.com/search?q={q}"),
        "duckduckgo" => format!("https://duckduckgo.com/?q={q}"),
        _ => format!("https://www.google.com/search?q={q}"),
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(String::from)
}

pub fn assess(nx: &Arc<Nexus>, spec: &ToolSpec, input: &Value) -> Result<Assessment> {
    let browser = s(input, "browser").or_else(|| {
        let d = nx.settings().default_browser;
        (d != "system").then_some(d)
    });
    let mut a = match spec.name {
        "browser.open" => {
            let u = parse_web_url(&s(input, "url").unwrap_or_default())?;
            Assessment::new(spec, format!("Open {}", u.host_str().unwrap_or(""))).detail("URL", u.as_str())
        }
        "browser.search" => {
            let q = s(input, "query").unwrap_or_default();
            Assessment::new(spec, format!("Search the web for \"{q}\""))
        }
        _ => {
            let u = parse_web_url(&s(input, "url").unwrap_or_default())?;
            return Ok(Assessment::new(spec, format!("Read {}", u.as_str())));
        }
    };
    if let Some(b) = browser {
        let app = super::desktop::find_app(nx, &b)?;
        a = a.detail("Browser", &app.name);
        a.app = Some((app.id.clone(), app.status));
    } else {
        a = a.detail("Browser", "Windows default browser");
    }
    Ok(a)
}

async fn open_in_browser(nx: &Arc<Nexus>, url: String, browser: Option<String>) -> Result<String> {
    let browser = browser.or_else(|| {
        let d = nx.settings().default_browser;
        (d != "system").then_some(d)
    });
    match browser {
        None => {
            tokio::task::spawn_blocking(move || apps::shell_open(&url, None)).await??;
            Ok("default browser".into())
        }
        Some(b) => {
            let app = super::desktop::find_app(nx, &b)?;
            if app.launch_target.starts_with("shell:AppsFolder") {
                bail!("{} is a packaged app and cannot be given a URL; choose another browser", app.name);
            }
            let target = app.exe_path.clone().unwrap_or(app.launch_target.clone());
            let name = app.name.clone();
            tokio::task::spawn_blocking(move || apps::shell_open(&target, Some(&url))).await??;
            Ok(name)
        }
    }
}

pub async fn call(nx: &Arc<Nexus>, run: &RunCtx, name: &str, input: Value) -> Result<ToolOutput> {
    match name {
        "browser.open" => {
            let u = parse_web_url(&s(&input, "url").unwrap_or_default())?;
            let used = open_in_browser(nx, u.to_string(), s(&input, "browser")).await?;
            Ok(ToolOutput::new(format!("Opened {} in {used}", u.as_str()), json!({"url": u.as_str(), "browser": used})))
        }
        "browser.search" => {
            let q = s(&input, "query").unwrap_or_default();
            let engine = s(&input, "engine").unwrap_or_else(|| nx.settings().search_engine);
            let u = search_url(&engine, &q);
            let used = open_in_browser(nx, u.clone(), s(&input, "browser")).await?;
            Ok(ToolOutput::new(format!("Searched {engine} for \"{q}\" in {used}"), json!({"url": u, "browser": used})))
        }
        "browser.read" => {
            let u = parse_web_url(&s(&input, "url").unwrap_or_default())?;
            let max = input.get("max_chars").and_then(|m| m.as_u64()).unwrap_or(20000) as usize;
            // Follow redirects by hand so every hop is checked against the public-address rule.
            static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
            let client = CLIENT.get_or_init(|| {
                reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) NEXUS/0.1")
                    .build()
                    .expect("http client")
            });
            let mut current = u.clone();
            let mut hops = 0;
            let resp = loop {
                ensure_public(&current).await?;
                let r = client
                    .get(current.clone())
                    .header("Accept", "text/html,text/plain;q=0.9,*/*;q=0.5")
                    .timeout(Duration::from_secs(25))
                    .send()
                    .await
                    .with_context(|| format!("Could not reach {}", current.host_str().unwrap_or("")))?;
                if r.status().is_redirection() {
                    let loc = r.headers().get("location").and_then(|l| l.to_str().ok()).ok_or_else(|| anyhow!("Redirect without location"))?;
                    current = parse_web_url(current.join(loc)?.as_str())?;
                    hops += 1;
                    if hops > 6 {
                        bail!("Too many redirects");
                    }
                    continue;
                }
                break r;
            };
            let status = resp.status();
            let final_url = resp.url().clone();
            let ctype = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
            if !(ctype.contains("html") || ctype.contains("text") || ctype.contains("json") || ctype.contains("xml") || ctype.is_empty()) {
                bail!("{} returned {ctype}, which is not a readable text page", final_url);
            }
            let mut body = Vec::new();
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if run.token.is_cancelled() {
                    bail!("Interrupted by STOP NEXUS");
                }
                body.extend_from_slice(&chunk?);
                if body.len() > 4 * 1024 * 1024 {
                    break;
                }
            }
            let text = if ctype.contains("html") || ctype.is_empty() {
                html2text::from_read(&body[..], 110).unwrap_or_else(|_| String::from_utf8_lossy(&body).to_string())
            } else {
                String::from_utf8_lossy(&body).to_string()
            };
            let title = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
                .ok()
                .and_then(|re| re.captures(&String::from_utf8_lossy(&body[..body.len().min(200_000)])).map(|c| c[1].trim().to_string()));
            let total = text.chars().count();
            let content: String = text.chars().take(max).collect();
            if !status.is_success() {
                return Err(anyhow!("{} answered HTTP {}", final_url, status));
            }
            Ok(ToolOutput::new(
                format!("Read {} ({} characters)", final_url, total),
                json!({"url": final_url.as_str(), "title": title, "status": status.as_u16(), "text": content, "truncated": total > max}),
            )
            .untrusted())
        }
        _ => Err(anyhow!("Tool {name} is not implemented")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_policy() {
        assert!(parse_web_url("example.com").is_ok());
        assert!(parse_web_url("file:///C:/Windows/win.ini").is_err());
        assert!(parse_web_url("javascript:alert(1)").is_err());
        assert!(is_private("127.0.0.1".parse().unwrap()));
        assert!(is_private("192.168.1.10".parse().unwrap()));
        assert!(!is_private("93.184.216.34".parse().unwrap()));
        assert!(search_url("google", "a b&c").ends_with("q=a+b%26c"));
    }
}
