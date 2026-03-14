/**
 * Native Tokenizer — KeiAI
 *
 * Rust-native token counting using:
 *   - tiktoken-rs (o200k_base) for OpenAI models
 *   - tokenizers (HuggingFace) for everything else
 *
 * Instances are lazy-loaded on first use and cached in managed state.
 * Token data files are bundled as Tauri resources under `token/`.
 */

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// ─── State ───────────────────────────────────────────────────────────────────

pub struct TokenizerState {
    tiktoken: Option<tiktoken_rs::CoreBPE>,
    hf: HashMap<String, tokenizers::Tokenizer>,
}

impl TokenizerState {
    pub fn new() -> Self {
        Self {
            tiktoken: None,
            hf: HashMap::new(),
        }
    }
}

// ─── Token File Resolution ───────────────────────────────────────────────────

fn token_path(app: &AppHandle, encoding: &str) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let rel = match encoding {
        "claude" => "token/claude/tokenizer.json",
        "llama3" => "token/llama3/tokenizer.json",
        "deepseek" => "token/deepseek/tokenizer.json",
        "gemma" => "token/gemma/tokenizer.json",
        "mistral" => "token/mistral/tokenizer.json",
        _ => return Err(format!("Unknown encoding: {encoding}")),
    };

    Ok(base.join(rel))
}

// ─── Command ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn count_tokens(
    state: tauri::State<'_, Mutex<TokenizerState>>,
    app: AppHandle,
    text: String,
    encoding: String,
) -> Result<usize, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // tiktoken-rs: o200k_base (built-in, no file needed)
    if encoding == "o200k_base" {
        if state.tiktoken.is_none() {
            state.tiktoken = Some(
                tiktoken_rs::o200k_base().map_err(|e| format!("tiktoken init failed: {e}"))?,
            );
        }
        let count = state
            .tiktoken
            .as_ref()
            .unwrap()
            .encode_with_special_tokens(&text)
            .len();
        return Ok(count);
    }

    // HuggingFace tokenizers: JSON vocab files
    if !state.hf.contains_key(&encoding) {
        let path = token_path(&app, &encoding)?;
        let tokenizer = tokenizers::Tokenizer::from_file(&path)
            .map_err(|e| format!("Failed to load tokenizer '{encoding}': {e}"))?;
        state.hf.insert(encoding.clone(), tokenizer);
    }

    let tokenizer = state.hf.get(&encoding).unwrap();
    let encoded = tokenizer
        .encode(&text, false)
        .map_err(|e| format!("Encoding failed: {e}"))?;
    Ok(encoded.get_ids().len())
}
