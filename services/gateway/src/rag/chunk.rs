//! C5 · chunking — [`DocIR`] → retrieval [`Chunk`]s.
//!
//! The [`StructuralChunker`] walks the parsed structure (spec §8.6, "structural/semantic default"):
//! prose is packed into `~target_tokens` windows with `overlap_pct` overlap, and each extracted
//! [`Table`](super::parse::Table) is emitted as ONE whole chunk (never split — tables lose meaning
//! when fragmented). `section_path`/`page_ref`/`element_type` are preserved so retrieval can cite
//! provenance. Token counting is a word approximation behind the single [`approx_tokens`] seam (a
//! real tokenizer is deferred, spec deferral list); `contextual_prefix` is left `None` (the
//! contextual-enrichment seam — the column is already folded into the generated `tsv`).
//!
//! No-hardcoded-ops: window size + overlap come from [`ChunkConfig`] (per-space config over the
//! fallback consts), so changing a space's config changes chunking with no code change.

use super::parse::{DocIR, ElementType};
use super::{ChunkConfig, RagError};

/// One retrieval unit written to `document_embeddings` (content + provenance). Field names mirror
/// the columns the store binds (`chunk_sequence`, `content`, `token_count`, `start/end_position`,
/// `section_path`, `page_ref`, `element_type`, `contextual_prefix`).
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub seq: i32,
    pub text: String,
    pub token_count: i32,
    pub section_path: Option<String>,
    pub page_ref: Option<i32>,
    pub start_position: Option<i32>,
    pub end_position: Option<i32>,
    pub element_type: &'static str,
    pub is_table: bool,
    /// Contextual-enrichment blurb (spec §2.6) — `None` in v1; the seam is the column + this field.
    pub contextual_prefix: Option<String>,
}

/// Chunk a parsed document per the resolved [`ChunkConfig`].
pub trait Chunker: Send + Sync {
    fn chunk(&self, ir: &DocIR, cfg: &ChunkConfig) -> Result<Vec<Chunk>, RagError>;
}

/// The v1 structural chunker: prose windows + whole-table chunks.
pub struct StructuralChunker;

impl Chunker for StructuralChunker {
    fn chunk(&self, ir: &DocIR, cfg: &ChunkConfig) -> Result<Vec<Chunk>, RagError> {
        let target = cfg.target_tokens.max(1);
        let overlap = ((target as f32) * cfg.overlap_pct.clamp(0.0, 0.9)).round() as usize;
        let mut out: Vec<Chunk> = Vec::new();
        let mut seq: i32 = 0;

        // Prose/heading blocks → token windows (headings fold into section_path, not their own chunk).
        for block in &ir.blocks {
            if block.element_type == ElementType::Heading {
                continue;
            }
            let section_path = join_section_path(&block.section_path);
            for (text, start, end) in window_tokens(&block.text, target, overlap) {
                let tokens = approx_tokens(&text) as i32;
                out.push(Chunk {
                    seq,
                    text,
                    token_count: tokens,
                    section_path: section_path.clone(),
                    page_ref: block.page_ref,
                    start_position: Some(start as i32),
                    end_position: Some(end as i32),
                    element_type: element_type_str(block.element_type),
                    is_table: false,
                    contextual_prefix: None,
                });
                seq += 1;
            }
        }

        // Tables → one whole chunk each (config-gated; never windowed).
        if cfg.tables_whole {
            for table in &ir.tables {
                if table.csv.trim().is_empty() {
                    continue;
                }
                out.push(Chunk {
                    seq,
                    text: table.csv.clone(),
                    token_count: approx_tokens(&table.csv) as i32,
                    section_path: table.caption.clone(),
                    page_ref: table.page_ref,
                    start_position: None,
                    end_position: None,
                    element_type: "table",
                    is_table: true,
                    contextual_prefix: None,
                });
                seq += 1;
            }
        }

        Ok(out)
    }
}

/// Word-count token approximation — the SINGLE swap point for a real tokenizer (tiktoken deferred).
pub fn approx_tokens(s: &str) -> usize {
    s.split_whitespace().count()
}

fn element_type_str(e: ElementType) -> &'static str {
    match e {
        ElementType::Heading => "heading",
        ElementType::Prose => "prose",
        ElementType::Table => "table",
        ElementType::Caption => "caption",
    }
}

fn join_section_path(path: &[String]) -> Option<String> {
    if path.is_empty() {
        None
    } else {
        Some(path.join(" > "))
    }
}

/// Split `text` into overlapping windows of `~target` whitespace tokens, returning
/// `(window_text, start_char, end_char)` where the char offsets locate the window in `text`. A
/// document shorter than one window yields a single window. `overlap` tokens carry to the next
/// window (bounded so progress is always made).
fn window_tokens(text: &str, target: usize, overlap: usize) -> Vec<(String, usize, usize)> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    // (token_str, byte_start, byte_end) for each whitespace-delimited token.
    let toks: Vec<(&str, usize, usize)> = trimmed
        .split_whitespace()
        .map(|t| {
            let start = t.as_ptr() as usize - trimmed.as_ptr() as usize;
            (t, start, start + t.len())
        })
        .collect();
    if toks.len() <= target {
        return vec![(trimmed.to_string(), 0, trimmed.len())];
    }
    // step forward by (target - overlap), always ≥ 1.
    let step = target.saturating_sub(overlap).max(1);
    let mut windows = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let end = (i + target).min(toks.len());
        let start_byte = toks[i].1;
        let end_byte = toks[end - 1].2;
        windows.push((trimmed[start_byte..end_byte].to_string(), start_byte, end_byte));
        if end == toks.len() {
            break;
        }
        i += step;
    }
    windows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::parse::{Block, DocIR, Table};

    fn ir(blocks: Vec<Block>, tables: Vec<Table>) -> DocIR {
        DocIR { markdown: String::new(), blocks, tables, images: vec![], page_count: None }
    }
    fn prose(text: &str, section: &[&str]) -> Block {
        Block {
            text: text.into(),
            section_path: section.iter().map(|s| s.to_string()).collect(),
            page_ref: None,
            element_type: ElementType::Prose,
        }
    }

    #[test]
    fn prose_split_into_windows_with_overlap() {
        // 30 tokens, target 10, overlap 20% (=2) → step 8 → windows at 0,8,16,24.
        let body = (0..30).map(|i| format!("w{i}")).collect::<Vec<_>>().join(" ");
        let cfg = ChunkConfig { strategy: "structural".into(), target_tokens: 10, overlap_pct: 0.2, tables_whole: true };
        let chunks = StructuralChunker.chunk(&ir(vec![prose(&body, &["Intro"])], vec![]), &cfg).unwrap();
        assert!(chunks.len() >= 3, "expected multiple windows, got {}", chunks.len());
        assert!(chunks.iter().all(|c| c.token_count <= 10));
        // overlap: consecutive windows share tokens (window1 starts before window0 ends).
        assert!(chunks[0].text.split_whitespace().last() == Some("w9"));
        assert!(chunks[1].text.split_whitespace().next() == Some("w8"), "2-token overlap");
        // section_path + monotonic seq preserved.
        assert!(chunks.iter().all(|c| c.section_path.as_deref() == Some("Intro")));
        assert_eq!(chunks.iter().map(|c| c.seq).collect::<Vec<_>>(), (0..chunks.len() as i32).collect::<Vec<_>>());
    }

    #[test]
    fn table_is_one_whole_chunk_never_split() {
        let big_csv = (0..500).map(|i| format!("r{i},v{i}")).collect::<Vec<_>>().join("\n");
        let cfg = ChunkConfig::default(); // target 512
        let chunks = StructuralChunker
            .chunk(&ir(vec![], vec![Table { caption: Some("Sheet1".into()), csv: big_csv.clone(), page_ref: Some(3) }]), &cfg)
            .unwrap();
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].is_table);
        assert_eq!(chunks[0].element_type, "table");
        assert_eq!(chunks[0].text, big_csv, "table content is intact (not windowed)");
        assert_eq!(chunks[0].section_path.as_deref(), Some("Sheet1"));
        assert_eq!(chunks[0].page_ref, Some(3));
    }

    #[test]
    fn headings_fold_into_section_path_not_own_chunk() {
        let blocks = vec![
            Block { text: "Overview".into(), section_path: vec![], page_ref: None, element_type: ElementType::Heading },
            prose("short body here", &["Overview"]),
        ];
        let chunks = StructuralChunker.chunk(&ir(blocks, vec![]), &ChunkConfig::default()).unwrap();
        assert_eq!(chunks.len(), 1, "heading is not its own chunk");
        assert_eq!(chunks[0].element_type, "prose");
        assert_eq!(chunks[0].section_path.as_deref(), Some("Overview"));
    }

    #[test]
    fn config_changes_output_no_code_change() {
        let body = (0..40).map(|i| format!("t{i}")).collect::<Vec<_>>().join(" ");
        let mk = |target| ChunkConfig { strategy: "structural".into(), target_tokens: target, overlap_pct: 0.1, tables_whole: true };
        let few = StructuralChunker.chunk(&ir(vec![prose(&body, &[])], vec![]), &mk(40)).unwrap();
        let many = StructuralChunker.chunk(&ir(vec![prose(&body, &[])], vec![]), &mk(8)).unwrap();
        assert_eq!(few.len(), 1);
        assert!(many.len() > few.len(), "smaller target_tokens ⇒ more chunks (config-driven)");
        // deterministic
        let again = StructuralChunker.chunk(&ir(vec![prose(&body, &[])], vec![]), &mk(8)).unwrap();
        assert_eq!(many, again);
    }
}
