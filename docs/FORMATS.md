<!-- Generated from src/lib/convert/capabilities.ts. Run `UPDATE_FORMATS=1 npx vitest run capabilities` after changing it. -->

## Opening and editing

| Format | Opens as | Edit in place |
| --- | --- | --- |
| Markdown (.md, .markdown, .mdx) | Source, split, rich and reading views | Everything: source, rich editing, tables as a sheet |
| Word document (.docx) | Formatted read-only view | Not in place. Convert to Markdown to edit; the original is kept. |
| Excel workbook (.xlsx) | Sheet view with sheet tabs and formulas | Cell values and formulas; every save keeps a version |
| CSV (.csv) | Sheet view, or as text | Cells (only edited rows are rewritten) or raw text |
| TSV (.tsv, .tab) | Sheet view, or as text | Cells (only edited rows are rewritten) or raw text |
| UNL (.unl) | Sheet view (pipe-delimited, columns A, B, C… with an optional header row), or as text | Cells (only edited rows are rewritten, keeping the trailing delimiter) or raw text |
| HTML (.html, .htm) | Source with highlighting | Source text |
| Plain text (.txt, .text, .log) | Text editor | Text |
| PDF (.pdf) | Page viewer with search, zoom and page navigation | No |
| PowerPoint (.pptx) | Text-only slide preview in presentation order (up to 20 MB) | No |
| OpenDocument (.odt, .ods, .odp) | Text-only content preview (up to 20 MB) | No |
| Audio and video | Playback controls when the device supports the codec | No |
| Images | Image preview when the device supports the format | No |
| Other files | Text editor when readable as text; otherwise file details and a 512-byte hexadecimal preview | Text files only |

## Converting and exporting

*Convert* creates a new file next to the original; the original is never changed. *Export* saves a copy outside MyDocs.

| Conversion | How | Keeps | Loses |
| --- | --- | --- | --- |
| Markdown → Word document | convert, export | Headings (as Word heading styles); Bold, italic, strikethrough, inline code; Bulleted, numbered and nested lists; Task lists (as ☐/☒); Links and heading links; Tables with alignment and a header row; Images stored in the workspace; Quotes and code blocks; Title, author and tags | Code block languages; Equations (kept as TeX text); Raw HTML (kept as text); Images from the web (kept as their description); Front matter fields other than title, author, subject, tags and dates |
| Markdown → HTML | convert, export | Everything the preview shows, as a standalone page; Links between documents (as relative links) | Diagrams render only when opened in MyDocs; Embedded workspace images are linked, not embedded |
| Markdown → Plain text | convert, export | All words, in order | All formatting; Link destinations; Images |
| Markdown → PDF | convert, export | Headings (also as PDF bookmarks); Bold, italic, strikethrough, inline code; Bulleted, numbered, nested and task lists; Tables with alignment, wrapping cells and a header row that repeats on every page; Quotes and code blocks; JPEG and PNG images stored in the workspace; Web and email links (clickable); Title, author and subject (as document properties) | Text outside Western European alphabets and emoji (written as ?). Print to PDF keeps them; Links to other documents, files and headings (written as plain text); Equations and diagrams (written as their source text); Images that are not JPEG or PNG, and images from the web |
| Markdown → Excel workbook | convert, export (all tables) | Every table, one per sheet; Plain numbers as numbers, TRUE/FALSE as booleans; Everything else (leading zeros, dates, codes) exactly as text | Text around the tables; Inline formatting inside cells (kept as Markdown text) |
| Markdown → CSV | convert, export (table) | One table, every cell exactly as written | Column alignment; Other tables |
| Word document → Markdown | convert | Headings (Word heading styles and Title); Bold, italic, strikethrough, underline, superscript, subscript; Bulleted, numbered and nested lists, with start numbers; Links and bookmarks; Tables (first row as header) with alignment; Embedded images (saved to an assets folder); Quotes and monospaced paragraphs as code; Title, author, subject and keywords | Comments and footnotes; Tracked changes (imported as accepted); Merged cells (split); Headers, footers, page layout and fonts; Shapes, charts and text box positions |
| Word document → HTML | export | Same as Word → Markdown | Same as Word → Markdown |
| Word document → Plain text | export | All words, in order | All formatting and images |
| Excel workbook → CSV | convert, export (sheet) | The values each cell shows (formula results, formatted dates) | Formulas (saved as their values); Other sheets; Number formats beyond the shown text |
| Excel workbook → TSV | convert, export (sheet) | The values each cell shows | Formulas (saved as their values); Other sheets |
| Excel workbook → Markdown | convert | Every sheet as a heading and a table of shown values | Formulas (saved as their values); Number types (cells become text) |
| CSV → Excel workbook | convert, export | Every value; Plain numbers as numbers, TRUE/FALSE as booleans; Leading zeros, dates and codes exactly as text | Nothing |
| CSV → Markdown | convert | Every value, as a table with the first row as header | Line breaks inside cells (become spaces) |
| CSV → TSV | convert, export | Every value | Nothing |
| TSV → Excel workbook | convert, export | Every value; Plain numbers as numbers | Nothing |
| TSV → Markdown | convert | Every value, as a table | Line breaks inside cells (become spaces) |
| TSV → CSV | convert, export | Every value | Nothing |
| UNL → Excel workbook | convert, export | Every value, one row per record; Plain numbers as numbers (250.0 keeps its decimal place); Leading zeros, dates and codes exactly as text | The trailing delimiter (it ends a row, it is not a column) |
| UNL → CSV | convert, export | Every value, including escaped delimiters and line breaks | The trailing delimiter (it ends a row, it is not a column) |
| UNL → TSV | convert, export | Every value | The trailing delimiter (it ends a row, it is not a column) |
| UNL → Markdown | convert | Every value, as a table with columns named A, B, C… | Line breaks inside cells (become spaces) |
| HTML → Markdown | convert | Headings, paragraphs, lists, quotes, code, tables, links, images; Bold, italic, strikethrough, underline, sub/superscript; Title, author, description and keywords | Styling and layout; Scripts, forms and embedded media; Merged table cells (split) |
| Word document → PDF | convert, export | Headings, lists, tables, links and quotes as read from the Word file; JPEG and PNG images; Bold, italic, underline, strikethrough and code | Page layout, fonts, colors, headers, footers, comments and tracked changes; Text outside Western European alphabets and emoji (written as ?); Images that are not JPEG or PNG |
| HTML → PDF | convert, export | Headings, lists, tables, links, quotes and code; Title and author | Styles and layout (the PDF uses its own page design); Images; Text outside Western European alphabets and emoji (written as ?) |
| Plain text → PDF | convert, export | All words; blank lines separate paragraphs | Text outside Western European alphabets and emoji (written as ?) |
| Plain text → Markdown | convert | All text; blank lines separate paragraphs; Markdown characters are escaped so nothing changes meaning | Nothing |

## Not supported

| What | Why |
| --- | --- |
| Google Docs and Google Sheets | Not connected. Download them as .docx or .xlsx and import those; export from MyDocs as .docx or .xlsx and upload to Google Drive. |
| Editing PDFs, or converting PDFs to text documents | PDFs have no reliable structure; text extraction would guess at headings, tables and reading order. |
| Editing Word documents in place | Word layout features (sections, fonts, comments) have no Markdown equivalent; converting first makes every loss visible before it happens. |
| Sync, sharing and real-time collaboration | MyDocs keeps documents on this device only. There is no server. |
| Formatted viewing of legacy .doc, .xls, .ppt and .rtf | These open as raw text or bytes with the original available to download. Save them as .docx, .xlsx or .pptx for a document preview. |
