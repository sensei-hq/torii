//! C5 · document parse — bytes → canonical markdown-first IR (`DocIR`).
//!
//! The first ingestion stage (C5 spec §4.3, build plan "parse"): normalize any supported upload
//! (PDF/DOCX/PPTX/XLSX/HTML/markdown/text/image) into one provider-agnostic [`DocIR`] — markdown,
//! structured [`Block`]s (with a best-effort `section_path` from headings), extracted [`Table`]s,
//! and [`ImageRef`]s — that the redact→chunk→embed stages consume unchanged.
//!
//! **v1 = Tier-0, clean-text-layer only (no-hardcoded-ops seams left in place):**
//! - **OCR is deferred.** [`ParseOpts::ocr`] is [`OcrTier::None`] only; a scanned/image-only PDF
//!   with no clean text layer returns a *degraded-but-valid* empty [`DocIR`] (never an error) so the
//!   pipeline can flag it — Tier-1 (CPU OCR) / Tier-2 (VLM OCR) plug in here later (spec §8.5).
//! - **No page/bbox provenance.** `pdf-extract` exposes whole-document text with no reliable
//!   per-page or bounding-box coordinates, so `page_ref`/page_count are best-effort `None`. A
//!   layout-aware backend (Docling, spec §8.4) fills these in behind the same trait later.
//! - **VLM image captioning is deferred.** Images are decoded for validity/dimensions only; the
//!   `ImageRef.caption` stays `None` until the captioning capability lands.
//! - **OOXML heading detection is deferred.** DOCX/PPTX runs become `Prose` blocks (style-based
//!   heading inference is a later refinement); markdown/HTML/text DO infer headings from `#`.
//!
//! No-hardcoded-ops: the parser backend is operator-selectable via [`ParseOpts::backend`]; v1 ships
//! exactly one ([`DefaultParser`], `backend = "default"`), and alternates (cloud agentic parsers,
//! which egress content) dispatch here behind per-tenant policy without a signature change.

use std::io::{Cursor, Read};

use super::RagError;

/// Parse raw bytes of a known `mime` into the canonical [`DocIR`]. Provider-agnostic
/// (no-hardcoded-ops): implementations are selected by [`ParseOpts::backend`].
pub trait DocumentParser: Send + Sync {
    fn parse(&self, bytes: &[u8], mime: &str, opts: &ParseOpts) -> Result<DocIR, RagError>;
}

/// The canonical, markdown-first intermediate representation every downstream stage consumes.
#[derive(Debug, Clone)]
pub struct DocIR {
    /// Normalized markdown for the whole document (the redact→chunk source of truth).
    pub markdown: String,
    /// Structured blocks in reading order, each with a best-effort `section_path`.
    pub blocks: Vec<Block>,
    /// Extracted tabular data (one per worksheet / detected table), serialized to CSV.
    pub tables: Vec<Table>,
    /// Extracted image assets (bytes preserved; captioning deferred to the VLM seam).
    pub images: Vec<ImageRef>,
    /// Best-effort page count (`None` in Tier-0 — no layout backend yet).
    pub page_count: Option<u32>,
}

/// One structural unit of a document (a heading, paragraph, table, or caption).
#[derive(Debug, Clone)]
pub struct Block {
    pub text: String,
    /// Ancestor heading trail (`["H1", "H2", …]`) resolved at this block's position.
    pub section_path: Vec<String>,
    /// Best-effort source page (`None` in Tier-0 — no page provenance yet).
    pub page_ref: Option<i32>,
    pub element_type: ElementType,
}

/// The kind of a [`Block`]. `Table`/`Caption` are reserved for layout-aware backends; the Tier-0
/// text/markdown/HTML path emits `Heading`/`Prose` only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementType {
    Heading,
    Prose,
    Table,
    Caption,
}

/// A tabular region, serialized to RFC-4180 CSV (properly quoted) for the `table_csv` asset.
#[derive(Debug, Clone)]
pub struct Table {
    pub caption: Option<String>,
    pub csv: String,
    pub page_ref: Option<i32>,
}

/// An extracted image. `bytes` are preserved verbatim for the `image` asset; `caption` is filled by
/// the deferred VLM-captioning capability.
#[derive(Debug, Clone)]
pub struct ImageRef {
    pub bytes: Vec<u8>,
    pub caption: Option<String>,
    pub page_ref: Option<i32>,
}

/// Per-parse options (operator/space config — no-hardcoded-ops).
#[derive(Debug, Clone)]
pub struct ParseOpts {
    /// OCR tier. v1 = [`OcrTier::None`] only (Tier-0 clean-text-layer); the seam for Tier-1/2.
    pub ocr: OcrTier,
    /// Selected parser backend id. v1 ships only `"default"` ([`DefaultParser`]).
    pub backend: String,
}

/// OCR tier selector. v1 exposes only `None`; higher tiers (CPU/VLM OCR) are the deferred seam.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OcrTier {
    None,
}

impl Default for ParseOpts {
    fn default() -> Self {
        Self {
            ocr: OcrTier::None,
            backend: "default".into(),
        }
    }
}

/// The v1 Tier-0 parser: pure-Rust, clean-text-layer, no OCR/network. Dispatches on `mime`.
pub struct DefaultParser;

impl DocumentParser for DefaultParser {
    fn parse(&self, bytes: &[u8], mime: &str, _opts: &ParseOpts) -> Result<DocIR, RagError> {
        // Normalize: drop any `; charset=…` parameter and lowercase (no-hardcoded-ops: the backend
        // would be dispatched from `_opts.backend` once more than one exists).
        let m = mime
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        match m.as_str() {
            "text/markdown" | "text/x-markdown" | "text/plain" => Ok(parse_text(bytes)),
            "text/html" | "application/xhtml+xml" => parse_html(bytes),
            "application/pdf" => parse_pdf(bytes),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
                parse_docx(bytes)
            }
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
                parse_pptx(bytes)
            }
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => parse_xlsx(bytes),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif" => parse_image(bytes),
            _ => Err(RagError::Unsupported("unsupported mime for parse")),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Text / markdown
// ---------------------------------------------------------------------------------------------

/// Passthrough: the utf8 text IS the markdown; blocks come from the shared markdown extractor.
/// Lossy decode is intentional (a stray byte degrades one char rather than failing the ingest).
fn parse_text(bytes: &[u8]) -> DocIR {
    let markdown = String::from_utf8_lossy(bytes).into_owned();
    let blocks = blocks_from_markdown(&markdown);
    DocIR {
        markdown,
        blocks,
        tables: vec![],
        images: vec![],
        page_count: None,
    }
}

/// Split markdown into `Heading`/`Prose` blocks, tracking a heading stack for `section_path`.
/// Headings are ATX (`#`…`######` followed by whitespace); consecutive non-blank, non-heading lines
/// coalesce into one paragraph (flushed on a blank line or heading).
fn blocks_from_markdown(md: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut stack: Vec<(usize, String)> = Vec::new(); // (level, heading text)
    let mut para: Vec<&str> = Vec::new();

    for raw in md.lines() {
        let line = raw.trim_end();
        if let Some((level, htext)) = parse_atx_heading(line) {
            flush_paragraph(&mut para, &stack, &mut blocks);
            // A new heading closes any open sections at its level or deeper.
            while matches!(stack.last(), Some(&(l, _)) if l >= level) {
                stack.pop();
            }
            let section_path = stack.iter().map(|(_, t)| t.clone()).collect();
            blocks.push(Block {
                text: htext.clone(),
                section_path,
                page_ref: None,
                element_type: ElementType::Heading,
            });
            stack.push((level, htext));
        } else if line.trim().is_empty() {
            flush_paragraph(&mut para, &stack, &mut blocks);
        } else {
            para.push(line);
        }
    }
    flush_paragraph(&mut para, &stack, &mut blocks);
    blocks
}

/// Emit the buffered paragraph (if any) as a `Prose` block under the current heading stack.
fn flush_paragraph(para: &mut Vec<&str>, stack: &[(usize, String)], blocks: &mut Vec<Block>) {
    if para.is_empty() {
        return;
    }
    let text = para.join("\n").trim().to_string();
    para.clear();
    if text.is_empty() {
        return;
    }
    blocks.push(Block {
        text,
        section_path: stack.iter().map(|(_, t)| t.clone()).collect(),
        page_ref: None,
        element_type: ElementType::Prose,
    });
}

/// Parse an ATX heading line → `(level, text)`. Requires `#`…`######` then whitespace then text
/// (so `#hashtag` and a bare `#` are NOT headings).
fn parse_atx_heading(line: &str) -> Option<(usize, String)> {
    let t = line.trim_start();
    let level = t.bytes().take_while(|&b| b == b'#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let after = &t[level..];
    if !after.starts_with([' ', '\t']) {
        return None;
    }
    let text = after.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some((level, text))
}

// ---------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------

/// Convert HTML/XHTML → markdown with `htmd`, then reuse the markdown block extractor.
fn parse_html(bytes: &[u8]) -> Result<DocIR, RagError> {
    let html = String::from_utf8_lossy(bytes);
    let markdown =
        htmd::convert(&html).map_err(|e| RagError::Parse(format!("html→markdown: {e}")))?;
    let blocks = blocks_from_markdown(&markdown);
    Ok(DocIR {
        markdown,
        blocks,
        tables: vec![],
        images: vec![],
        page_count: None,
    })
}

// ---------------------------------------------------------------------------------------------
// PDF (text layer only — Tier-0)
// ---------------------------------------------------------------------------------------------

/// Extract the PDF text layer with `pdf-extract`. Whole-document text (no reliable page/bbox from
/// this backend) → `Prose` blocks split on blank lines. Empty/garbled text = a scanned/image-only
/// PDF with no clean text layer: return a degraded-but-valid empty [`DocIR`] (the OCR seam), NOT an
/// error, so the pipeline flags it for Tier-1/2 later.
fn parse_pdf(bytes: &[u8]) -> Result<DocIR, RagError> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|e| RagError::Parse(format!("pdf text-layer: {e}")))?;
    if text.trim().is_empty() {
        tracing::debug!("rag::parse: pdf has no clean text layer (scanned?); OCR deferred (Tier-0)");
        return Ok(DocIR {
            markdown: String::new(),
            blocks: vec![],
            tables: vec![],
            images: vec![],
            page_count: None,
        });
    }
    let blocks = prose_paragraphs(&text);
    Ok(DocIR {
        markdown: text,
        blocks,
        tables: vec![],
        images: vec![],
        page_count: None,
    })
}

/// Group text into `Prose` blocks separated by blank lines (used for the flat PDF/OOXML text layer).
fn prose_paragraphs(text: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut para: Vec<&str> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            push_prose(&mut para, &mut blocks);
        } else {
            para.push(line);
        }
    }
    push_prose(&mut para, &mut blocks);
    blocks
}

fn push_prose(para: &mut Vec<&str>, blocks: &mut Vec<Block>) {
    if para.is_empty() {
        return;
    }
    let text = para.join("\n").trim().to_string();
    para.clear();
    if !text.is_empty() {
        blocks.push(Block {
            text,
            section_path: vec![],
            page_ref: None,
            element_type: ElementType::Prose,
        });
    }
}

// ---------------------------------------------------------------------------------------------
// OOXML — DOCX & PPTX share one zip + quick-xml text-run extractor (docx-rs dropped)
// ---------------------------------------------------------------------------------------------

/// DOCX: pull `<w:t>` text runs from `word/document.xml` into `Prose` blocks.
fn parse_docx(bytes: &[u8]) -> Result<DocIR, RagError> {
    let xml = read_zip_entry(bytes, "word/document.xml")?;
    Ok(docir_from_runs(extract_runs(&xml, b"w:t")))
}

/// PPTX: pull `<a:t>` text runs from every `ppt/slides/slideN.xml` (slide-ordered) into `Prose`.
fn parse_pptx(bytes: &[u8]) -> Result<DocIR, RagError> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| RagError::Parse(format!("pptx zip: {e}")))?;
    let mut slides: Vec<String> = zip
        .file_names()
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .map(|s| s.to_string())
        .collect();
    slides.sort_by_key(|n| slide_index(n));

    let mut runs = Vec::new();
    for name in &slides {
        let mut f = zip
            .by_name(name)
            .map_err(|e| RagError::Parse(format!("pptx entry {name}: {e}")))?;
        let mut xml = String::new();
        f.read_to_string(&mut xml)
            .map_err(|e| RagError::Parse(format!("pptx read {name}: {e}")))?;
        runs.extend(extract_runs(&xml, b"a:t"));
    }
    Ok(docir_from_runs(runs))
}

/// Numeric slide ordering: `ppt/slides/slide10.xml` sorts after `slide2.xml` (not lexically).
fn slide_index(name: &str) -> u32 {
    name.strip_prefix("ppt/slides/slide")
        .and_then(|s| s.strip_suffix(".xml"))
        .and_then(|s| s.parse().ok())
        .unwrap_or(u32::MAX)
}

/// Read one named entry from an in-memory zip archive as a UTF-8 string.
fn read_zip_entry(bytes: &[u8], name: &str) -> Result<String, RagError> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| RagError::Parse(format!("zip open: {e}")))?;
    let mut f = zip
        .by_name(name)
        .map_err(|e| RagError::Parse(format!("zip entry {name}: {e}")))?;
    let mut s = String::new();
    f.read_to_string(&mut s)
        .map_err(|e| RagError::Parse(format!("zip read {name}: {e}")))?;
    Ok(s)
}

/// Pull the text of every `<run_tag>…</run_tag>` element (e.g. `w:t`/`a:t`) via quick-xml. Matches
/// on the qualified name so `<w:tab>` etc. are ignored. Best-effort: malformed XML ends extraction.
fn extract_runs(xml: &str, run_tag: &[u8]) -> Vec<String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut runs = Vec::new();
    let mut in_run = false;
    let mut cur = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == run_tag => {
                in_run = true;
                cur.clear();
            }
            Ok(Event::Text(e)) if in_run => {
                // quick-xml 0.41 splits decode (bytes→str) from entity unescaping; do both.
                if let Ok(decoded) = e.decode() {
                    match quick_xml::escape::unescape(&decoded) {
                        Ok(unescaped) => cur.push_str(&unescaped),
                        Err(_) => cur.push_str(&decoded),
                    }
                }
            }
            Ok(Event::End(e)) if e.name().as_ref() == run_tag => {
                in_run = false;
                let t = cur.trim();
                if !t.is_empty() {
                    runs.push(t.to_string());
                }
                cur.clear();
            }
            Ok(Event::Eof) => break,
            Err(_) => break, // best-effort — fixtures are well-formed
            _ => {}
        }
    }
    runs
}

/// One `Prose` block per non-empty text run; markdown = the runs joined by blank lines.
fn docir_from_runs(runs: Vec<String>) -> DocIR {
    let blocks: Vec<Block> = runs
        .iter()
        .map(|r| Block {
            text: r.clone(),
            section_path: vec![],
            page_ref: None,
            element_type: ElementType::Prose,
        })
        .collect();
    let markdown = runs.join("\n\n");
    DocIR {
        markdown,
        blocks,
        tables: vec![],
        images: vec![],
        page_count: None,
    }
}

// ---------------------------------------------------------------------------------------------
// XLSX — calamine → one Table per worksheet (CSV via the `csv` crate) + a folded markdown table
// ---------------------------------------------------------------------------------------------

/// XLSX: each worksheet → one [`Table`] (RFC-4180 CSV) plus a GFM markdown table folded into
/// `markdown`. Numbers, bools, and dates are stringified; empty cells stay empty.
fn parse_xlsx(bytes: &[u8]) -> Result<DocIR, RagError> {
    use calamine::{Reader, Xlsx};

    let mut wb: Xlsx<_> = calamine::open_workbook_from_rs(Cursor::new(bytes))
        .map_err(|e| RagError::Parse(format!("xlsx open: {e}")))?;

    let mut tables = Vec::new();
    let mut markdown = String::new();
    for sheet in wb.sheet_names().to_vec() {
        let range = wb
            .worksheet_range(&sheet)
            .map_err(|e| RagError::Parse(format!("xlsx sheet {sheet}: {e}")))?;
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|r| r.iter().map(cell_to_string).collect())
            .collect();

        tables.push(Table {
            caption: Some(sheet.clone()),
            csv: rows_to_csv(&rows)?,
            page_ref: None,
        });
        markdown.push_str(&rows_to_md_table(&sheet, &rows));
        markdown.push_str("\n\n");
    }

    Ok(DocIR {
        markdown: markdown.trim_end().to_string(),
        blocks: vec![],
        tables,
        images: vec![],
        page_count: None,
    })
}

/// Stringify a calamine cell for CSV/markdown; whole floats render without a trailing `.0`.
fn cell_to_string(d: &calamine::Data) -> String {
    use calamine::Data;
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                (*f as i64).to_string()
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => dt.to_string(),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{e:?}"),
    }
}

/// Serialize rows to RFC-4180 CSV with proper quoting via the `csv` crate.
fn rows_to_csv(rows: &[Vec<String>]) -> Result<String, RagError> {
    let mut w = csv::WriterBuilder::new().from_writer(Vec::new());
    for row in rows {
        w.write_record(row)
            .map_err(|e| RagError::Parse(format!("csv write: {e}")))?;
    }
    let inner = w
        .into_inner()
        .map_err(|e| RagError::Parse(format!("csv flush: {e}")))?;
    String::from_utf8(inner).map_err(|e| RagError::Parse(format!("csv utf8: {e}")))
}

/// Fold rows into a GFM markdown table (first row = header). Pipes/newlines in cells are escaped.
fn rows_to_md_table(sheet: &str, rows: &[Vec<String>]) -> String {
    let mut out = format!("### {sheet}\n\n");
    if rows.is_empty() {
        out.push_str("_(empty sheet)_\n");
        return out;
    }
    let ncols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let esc = |s: &str| s.replace('|', "\\|").replace('\n', " ");
    let write_row = |out: &mut String, row: &[String]| {
        out.push('|');
        for c in 0..ncols {
            out.push(' ');
            out.push_str(&esc(row.get(c).map(String::as_str).unwrap_or("")));
            out.push_str(" |");
        }
        out.push('\n');
    };

    write_row(&mut out, &rows[0]);
    out.push('|');
    for _ in 0..ncols {
        out.push_str(" --- |");
    }
    out.push('\n');
    for row in &rows[1..] {
        write_row(&mut out, row);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Images (validity/dimension decode only — captioning deferred)
// ---------------------------------------------------------------------------------------------

/// Decode the image header (validity + dimensions) with the `image` crate, then emit one
/// [`ImageRef`] preserving the original bytes. Captioning (VLM) is the deferred seam, so
/// `caption`/`page_ref` are `None` and `markdown` is empty.
fn parse_image(bytes: &[u8]) -> Result<DocIR, RagError> {
    let _dims = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| RagError::Parse(format!("image read: {e}")))?
        .into_dimensions()
        .map_err(|e| RagError::Parse(format!("image decode: {e}")))?;
    Ok(DocIR {
        markdown: String::new(),
        blocks: vec![],
        tables: vec![],
        images: vec![ImageRef {
            bytes: bytes.to_vec(),
            caption: None,
            page_ref: None,
        }],
        page_count: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn parse(bytes: &[u8], mime: &str) -> Result<DocIR, RagError> {
        DefaultParser.parse(bytes, mime, &ParseOpts::default())
    }

    // -- helpers to build binary fixtures in-test (no committed blobs) --------------------------

    /// Build an in-memory zip (Stored) from `(name, contents)` parts.
    fn build_zip(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, body) in parts {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(body.as_bytes()).unwrap();
        }
        zw.finish().unwrap().into_inner()
    }

    /// Hand-roll a minimal valid single-page PDF whose content stream shows `text` (a single token,
    /// so pdf-extract keeps it contiguous). xref byte-offsets are computed so lopdf reads it.
    fn build_pdf(text: &str) -> Vec<u8> {
        let content = format!("BT /F1 24 Tf 72 700 Td ({text}) Tj ET");
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R \
              /Resources << /Font << /F1 5 0 R >> >> >>"
                .to_string(),
            format!(
                "<< /Length {} >>\nstream\n{}\nendstream",
                content.len(),
                content
            ),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ];

        let mut pdf: Vec<u8> = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.4\n");
        let mut offsets = Vec::new();
        for (i, obj) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, obj).as_bytes());
        }
        let xref_start = pdf.len();
        let size = objects.len() + 1; // + the free object 0
        pdf.extend_from_slice(format!("xref\n0 {size}\n").as_bytes());
        pdf.extend_from_slice(b"0000000000 65535 f \n"); // 20-byte free entry for obj 0
        for off in &offsets {
            pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes()); // 20-byte entries
        }
        pdf.extend_from_slice(
            format!("trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF")
                .as_bytes(),
        );
        pdf
    }

    /// Encode a tiny 2x2 PNG in-test with the `image` crate.
    fn build_png_2x2() -> Vec<u8> {
        let mut img = image::RgbaImage::new(2, 2);
        for (i, px) in img.pixels_mut().enumerate() {
            *px = image::Rgba([(i * 40) as u8, 20, 30, 255]);
        }
        let mut buf = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        buf.into_inner()
    }

    // -- markdown / text / html -----------------------------------------------------------------

    #[test]
    fn markdown_headings_and_section_path() {
        let md = "# Title\n\nIntro paragraph.\n\n## Section A\n\nBody of A.\n";
        let ir = parse(md.as_bytes(), "text/markdown").unwrap();
        assert!(!ir.markdown.is_empty());

        let find = |t: &str| ir.blocks.iter().find(|b| b.text == t).unwrap();
        let title = find("Title");
        assert_eq!(title.element_type, ElementType::Heading);
        assert!(title.section_path.is_empty());

        let intro = find("Intro paragraph.");
        assert_eq!(intro.element_type, ElementType::Prose);
        assert_eq!(intro.section_path, vec!["Title".to_string()]);

        let sec = find("Section A");
        assert_eq!(sec.element_type, ElementType::Heading);
        assert_eq!(sec.section_path, vec!["Title".to_string()]);

        let body = find("Body of A.");
        assert_eq!(
            body.section_path,
            vec!["Title".to_string(), "Section A".to_string()]
        );
    }

    #[test]
    fn plain_text_hash_line_is_heading() {
        let ir = parse(b"# Heading line\nplain body line", "text/plain").unwrap();
        assert_eq!(ir.blocks[0].element_type, ElementType::Heading);
        assert_eq!(ir.blocks[0].text, "Heading line");
        // `#hashtag` (no space) is NOT a heading.
        let ir2 = parse(b"#hashtag not a heading", "text/plain").unwrap();
        assert_eq!(ir2.blocks[0].element_type, ElementType::Prose);
    }

    #[test]
    fn html_to_markdown_blocks() {
        let html = "<h1>Report</h1><p>Hello <strong>world</strong>.</p>\
                    <h2>Details</h2><p>More text.</p>";
        let ir = parse(html.as_bytes(), "text/html").unwrap();
        assert!(!ir.markdown.is_empty(), "markdown: {:?}", ir.markdown);
        assert!(ir
            .blocks
            .iter()
            .any(|b| b.element_type == ElementType::Heading && b.text.contains("Report")));
        assert!(ir
            .blocks
            .iter()
            .any(|b| b.element_type == ElementType::Prose && b.text.contains("world")));
    }

    // -- pdf ------------------------------------------------------------------------------------

    #[test]
    fn pdf_text_layer_extracted() {
        let pdf = build_pdf("ToriiPdfMarker");
        let ir = parse(&pdf, "application/pdf").unwrap();
        assert!(
            ir.markdown.contains("ToriiPdfMarker"),
            "extracted text: {:?}",
            ir.markdown
        );
        assert!(ir
            .blocks
            .iter()
            .any(|b| b.text.contains("ToriiPdfMarker") && b.element_type == ElementType::Prose));
    }

    #[test]
    fn pdf_without_text_layer_is_degraded_not_error() {
        // Empty text-showing operator → no clean text layer (the scanned-PDF / OCR seam).
        let pdf = build_pdf("");
        let ir = parse(&pdf, "application/pdf").unwrap();
        assert!(ir.markdown.trim().is_empty(), "markdown: {:?}", ir.markdown);
        assert!(ir.blocks.is_empty());
    }

    // -- xlsx / docx / pptx (OOXML built in-test) -----------------------------------------------

    #[test]
    fn xlsx_worksheet_to_csv_and_markdown() {
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;
        let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;
        let workbook = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;
        let workbook_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;
        let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Score</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>Alice</t></is></c><c r="B2"><v>90</v></c></row>
</sheetData>
</worksheet>"#;
        let xlsx = build_zip(&[
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", root_rels),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_rels),
            ("xl/worksheets/sheet1.xml", sheet),
        ]);

        let ir = parse(
            &xlsx,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .unwrap();
        assert_eq!(ir.tables.len(), 1);
        let csv = &ir.tables[0].csv;
        assert!(csv.contains("Name,Score"), "csv: {csv:?}");
        assert!(csv.contains("Alice,90"), "csv: {csv:?}");
        assert_eq!(ir.tables[0].caption.as_deref(), Some("Sheet1"));
        assert!(ir.markdown.contains("Alice"), "markdown: {:?}", ir.markdown);
    }

    #[test]
    fn docx_text_runs_extracted() {
        let document = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Hello from DOCX</w:t></w:r></w:p>
<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
</w:body>
</w:document>"#;
        let docx = build_zip(&[("word/document.xml", document)]);
        let ir = parse(
            &docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .unwrap();
        assert!(ir.markdown.contains("Hello from DOCX"));
        assert!(ir.markdown.contains("Second paragraph"));
        assert!(ir
            .blocks
            .iter()
            .any(|b| b.text == "Hello from DOCX" && b.element_type == ElementType::Prose));
    }

    #[test]
    fn pptx_slide_runs_extracted_in_order() {
        let slide = |title: &str, bullet: &str| {
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>
<a:p><a:r><a:t>{title}</a:t></a:r></a:p>
<a:p><a:r><a:t>{bullet}</a:t></a:r></a:p>
</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#
            )
        };
        let s1 = slide("Slide One", "First bullet");
        let s2 = slide("Slide Two", "Second bullet");
        // Deliberately add slides out of lexical-vs-numeric order to exercise slide_index sorting.
        let pptx = build_zip(&[
            ("ppt/slides/slide2.xml", s2.as_str()),
            ("ppt/slides/slide1.xml", s1.as_str()),
        ]);
        let ir = parse(
            &pptx,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        .unwrap();
        assert!(ir.markdown.contains("Slide One"));
        assert!(ir.markdown.contains("Second bullet"));
        // slide1 content precedes slide2 content despite insertion order.
        let one = ir.markdown.find("Slide One").unwrap();
        let two = ir.markdown.find("Slide Two").unwrap();
        assert!(one < two, "slides not numerically ordered: {:?}", ir.markdown);
    }

    // -- image ----------------------------------------------------------------------------------

    #[test]
    fn image_png_yields_imageref() {
        let png = build_png_2x2();
        let ir = parse(&png, "image/png").unwrap();
        assert_eq!(ir.images.len(), 1);
        assert_eq!(ir.images[0].bytes, png);
        assert!(ir.images[0].caption.is_none());
        assert!(ir.images[0].page_ref.is_none());
        assert!(ir.markdown.is_empty());
        assert!(ir.blocks.is_empty());
    }

    #[test]
    fn corrupt_image_is_parse_error() {
        let err = parse(b"not a real png", "image/png").unwrap_err();
        assert!(matches!(err, RagError::Parse(_)), "got {err:?}");
    }

    // -- dispatch -------------------------------------------------------------------------------

    #[test]
    fn unknown_mime_is_unsupported() {
        let err = parse(b"whatever", "application/x-nonsense").unwrap_err();
        assert!(matches!(err, RagError::Unsupported(_)), "got {err:?}");
    }

    #[test]
    fn mime_charset_parameter_is_ignored() {
        let ir = parse(b"# Hi\n\nbody", "text/markdown; charset=utf-8").unwrap();
        assert_eq!(ir.blocks[0].text, "Hi");
    }
}
