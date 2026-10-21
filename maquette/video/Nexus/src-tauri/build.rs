use std::path::Path;

fn main() {
    embed_builtin_pack();
    tauri_build::build()
}

/// Embeds assets/builtin/* (the base cosmetic pack) into the binary. At startup
/// NEXUS writes it to <data>/nexus-assets/builtin, where it is discovered like
/// any other pack.
fn embed_builtin_pack() {
    let root = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("assets").join("builtin");
    println!("cargo:rerun-if-changed=assets/builtin");
    let mut files: Vec<_> = std::fs::read_dir(&root).expect("assets/builtin missing").flatten().filter(|e| e.path().is_file()).collect();
    files.sort_by_key(|e| e.file_name());
    let mut out = String::from("pub static BUILTIN_PACK: &[(&str, &[u8])] = &[\n");
    for e in files {
        let name = e.file_name().to_string_lossy().to_string();
        out.push_str(&format!("    ({:?}, include_bytes!({:?})),\n", name, e.path().display().to_string()));
    }
    out.push_str("];\n");
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("builtin_pack.rs");
    std::fs::write(dest, out).unwrap();
}
