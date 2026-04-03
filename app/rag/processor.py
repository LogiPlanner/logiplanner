"""
Document Processor
==================
Handles loading, splitting, and metadata enrichment of documents
before they are embedded and stored in the vector database.

Supported formats: PDF, DOCX, TXT, MD
"""

import os
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from langchain_community.document_loaders import (
    PyPDFLoader,
    TextLoader,
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document as LCDocument

from app.core.config import settings


# ─── Supported file extensions → loader mapping ───
SUPPORTED_EXTENSIONS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".txt": "txt",
    ".md": "markdown",
}

# Maximum file size: 20MB
MAX_FILE_SIZE = 20 * 1024 * 1024


def get_doc_type(filename: str) -> Optional[str]:
    """Get document type from filename extension."""
    ext = os.path.splitext(filename)[1].lower()
    return SUPPORTED_EXTENSIONS.get(ext)


def validate_file(filename: str, file_size: int) -> tuple[bool, str]:
    """
    Validate a file before processing.
    Returns (is_valid, error_message).
    """
    doc_type = get_doc_type(filename)
    if not doc_type:
        supported = ", ".join(SUPPORTED_EXTENSIONS.keys())
        return False, f"Unsupported file type. Supported: {supported}"

    if file_size > MAX_FILE_SIZE:
        return False, f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB"

    if file_size == 0:
        return False, "File is empty"

    return True, ""


def _load_docx(file_path: str) -> List[LCDocument]:
    """Load a DOCX file using python-docx for robust handling of complex documents."""
    from docx import Document as DocxDocument
    doc = DocxDocument(file_path)
    paragraphs = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)
    # Also extract text from tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                text = cell.text.strip()
                if text:
                    paragraphs.append(text)
    full_text = "\n\n".join(paragraphs)
    if not full_text.strip():
        raise ValueError("No readable text found in DOCX file")
    return [LCDocument(page_content=full_text, metadata={"source": file_path})]


def load_document(file_path: str, filename: str) -> List[LCDocument]:
    """
    Load a document using the appropriate LangChain loader.
    Returns a list of LangChain Document objects (one per page for PDFs).
    """
    doc_type = get_doc_type(filename)

    if doc_type == "pdf":
        loader = PyPDFLoader(file_path)
        return loader.load()
    elif doc_type == "docx":
        return _load_docx(file_path)
    elif doc_type in ("txt", "markdown"):
        loader = TextLoader(file_path, encoding="utf-8")
        return loader.load()
    else:
        raise ValueError(f"Unsupported document type: {doc_type}")


def split_documents(
    documents: List[LCDocument],
    chunk_size: int = None,
    chunk_overlap: int = None,
) -> List[LCDocument]:
    """
    Split documents into chunks using RecursiveCharacterTextSplitter.
    This preserves semantic coherence by splitting on natural boundaries
    (paragraphs → sentences → words) in that order.
    """
    chunk_size = chunk_size or settings.RAG_CHUNK_SIZE
    chunk_overlap = chunk_overlap or settings.RAG_CHUNK_OVERLAP

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
        is_separator_regex=False,
    )

    return splitter.split_documents(documents)


def enrich_metadata(
    chunks: List[LCDocument],
    team_id: int,
    document_id: int,
    filename: str,
    uploader_email: str,
    doc_type: str,
) -> List[LCDocument]:
    """
    Enrich each chunk with metadata for filtering and traceability.

    Metadata fields added to each chunk:
    - team_id: Which team this document belongs to
    - document_id: Database ID of the parent document record
    - filename: Original filename for source citations
    - uploader_email: Who uploaded this document
    - doc_type: pdf/docx/txt/markdown
    - chunk_index: Position of this chunk in the document
    - page_number: Page number (for PDFs, from loader metadata)
    - uploaded_at: ISO timestamp of when the document was ingested
    """
    uploaded_at = datetime.now(timezone.utc).isoformat()

    for i, chunk in enumerate(chunks):
        # Preserve any existing metadata from loaders (e.g., page number from PDF)
        existing_meta = chunk.metadata or {}

        chunk.metadata = {
            "team_id": team_id,
            "document_id": document_id,
            "filename": filename,
            "uploader_email": uploader_email,
            "doc_type": doc_type,
            "chunk_index": i,
            "page_number": existing_meta.get("page", 0),
            "uploaded_at": uploaded_at,
            # Keep source from loader if present
            "source": existing_meta.get("source", filename),
        }

    return chunks


def process_document(
    file_path: str,
    filename: str,
    team_id: int,
    document_id: int,
    uploader_email: str,
) -> List[LCDocument]:
    """
    Full document processing pipeline:
    1. Load the document
    2. Split into chunks
    3. Enrich with metadata

    Returns list of processed, metadata-enriched chunks ready for embedding.
    """
    doc_type = get_doc_type(filename)
    if not doc_type:
        raise ValueError(f"Unsupported file: {filename}")

    # Step 1: Load
    raw_docs = load_document(file_path, filename)

    if not raw_docs:
        raise ValueError(f"No content could be extracted from {filename}")

    # Step 2: Split
    chunks = split_documents(raw_docs)

    if not chunks:
        raise ValueError(f"Document {filename} produced no chunks after splitting")

    # Step 3: Enrich metadata
    enriched = enrich_metadata(
        chunks=chunks,
        team_id=team_id,
        document_id=document_id,
        filename=filename,
        uploader_email=uploader_email,
        doc_type=doc_type,
    )

    return enriched


def process_text(
    text: str,
    title: str,
    team_id: int,
    document_id: int,
    uploader_email: str,
) -> List[LCDocument]:
    """
    Process raw text (e.g., notes, context) into chunks.
    Used for ingesting text directly without a file.
    """
    if not text or not text.strip():
        raise ValueError("Text content is empty")

    # Create a single LangChain document from the text
    doc = LCDocument(
        page_content=text,
        metadata={"source": title},
    )

    # Split
    chunks = split_documents([doc])

    # Enrich
    enriched = enrich_metadata(
        chunks=chunks,
        team_id=team_id,
        document_id=document_id,
        filename=title,
        uploader_email=uploader_email,
        doc_type="text",
    )

    return enriched
