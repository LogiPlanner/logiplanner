# LogiPlanner RAG System — Complete Documentation

> **Purpose:** Explain every aspect of the RAG (Retrieval-Augmented Generation) system so you can understand, modify, and extend it confidently.

---

## 1 · What Is RAG and Why We Built It

**RAG (Retrieval-Augmented Generation)** is a technique where an AI model answers questions by first *retrieving* relevant documents from a knowledge base, then *generating* a response grounded in those documents — instead of making up answers from its general training data.

### Why RAG is perfect for LogiPlanner

LogiPlanner's core value proposition is: *"Notion AI guesses what happened. LogiPlanner **knows** what happened because a human verifies it."*

RAG makes this real:
- Every AI answer is **grounded in documents that humans have uploaded and verified**
- The AI **cites its sources** (which file, which page) — fully traceable
- Each team's data is **isolated** — Team A can never see Team B's documents
- **No hallucinations** — if the knowledge base doesn't have the answer, the AI says so honestly

---

## 2 · Architecture Overview

```
USER UPLOADS A PDF
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  PROCESSOR  (app/rag/processor.py)                       │
│                                                          │
│  1. LOAD: PyPDFLoader reads the PDF, extracts text       │
│  2. SPLIT: RecursiveCharacterTextSplitter chops it       │
│     into 800-character chunks with 200-char overlap      │
│  3. ENRICH: Each chunk gets tagged with metadata:        │
│     • team_id (whose knowledge base)                     │
│     • document_id (which file)                           │
│     • uploader_email (who uploaded it)                   │
│     • filename, doc_type, page_number, chunk_index       │
│     • uploaded_at (ISO timestamp)                        │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  ENGINE  (app/rag/engine.py)                              │
│                                                          │
│  4. EMBED: OpenAI text-embedding-3-small converts        │
│     each chunk into a 1536-dimensional vector            │
│  5. STORE: ChromaDB saves the vector + metadata          │
│     in a per-team collection (team_1_knowledge,          │
│     team_2_knowledge, etc.)                              │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
                   LOCAL ./chroma_data/ FOLDER
                   (survives server restarts)


USER ASKS A QUESTION
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  ENGINE → SEARCH                                         │
│                                                          │
│  1. Convert the question to an embedding vector          │
│  2. Search ChromaDB for the 5 most similar chunks        │
│     (filtered by team_id for isolation)                  │
│  3. Assemble the chunks as "context"                     │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  ENGINE → CHAT                                           │
│                                                          │
│  4. Build a prompt with:                                 │
│     • System prompt (from prompts.py) — defines          │
│       the AI's personality and rules                     │
│     • Context from retrieved chunks                      │
│     • Recent chat history (last 10 exchanges)            │
│     • The user's question                                │
│  5. Send to GPT-4o                                       │
│  6. Return the answer + source citations                 │
└─────────────────────────────────────────────────────────┘
```

---

## 3 · Folder Structure

```
app/rag/                           ← RAG SYSTEM (THE BRAINS)
├── __init__.py                    # Package docstring
├── engine.py                      # RAG engine: ChromaDB + OpenAI orchestration
├── processor.py                   # Document loading, splitting, metadata enrichment
└── prompts.py                     # AI system prompts and templates

app/api/v1/rag.py                  ← API ROUTES
                                   # POST /rag/ingest       (upload files)
                                   # POST /rag/ingest-text  (ingest raw text)
                                   # GET  /rag/documents/   (list docs)
                                   # DELETE /rag/documents/  (delete doc)
                                   # GET  /rag/stats/       (knowledge base stats)
                                   # POST /rag/chat         (ask AI Brain)
                                   # GET  /rag/chat/history (chat history)
                                   # DELETE /rag/chat/history (clear history)

app/schemas/rag.py                 ← PYDANTIC SCHEMAS
                                   # Request/response models for all RAG endpoints

app/models/user.py                 ← DATABASE MODELS (new additions)
                                   # Document model: tracks uploaded files
                                   # ChatMessage model: stores chat history

app/templates/ai-brain.html        ← HTML PAGE (3-panel layout)
app/static/ai-brain/css/ai-brain.css  ← STYLES (dark glassmorphism)
app/static/ai-brain/js/ai-brain.js    ← FRONTEND LOGIC (upload, chat, stats)

chroma_data/                       ← VECTOR DATABASE (auto-created, gitignored)
app/static/uploads/rag/            ← UPLOADED FILES (gitignored)
```

---

## 4 · Each File Explained in Detail

### 4.1 · `app/rag/engine.py` — The RAG Engine

This is the **core orchestration layer**. It's a singleton class (`rag_engine`) that manages everything:

| Method | What it does |
|---|---|
| `_ensure_initialized()` | Lazy init — only connects to ChromaDB and OpenAI when first used |
| `ingest_chunks(team_id, chunks)` | Stores pre-processed chunks in the team's ChromaDB collection |
| `delete_document_chunks(team_id, doc_id)` | Removes all chunks for a deleted document |
| `search(team_id, query, k, filters)` | Similarity search with optional metadata filtering |
| `chat(team_id, query, history, filters)` | Full RAG pipeline: search → context → GPT-4o → response with sources |
| `get_stats(team_id)` | Returns document count, chunk count, type breakdown |

**Key design decisions:**
- **Lazy initialization** — The engine doesn't connect to OpenAI or ChromaDB until you actually call a method. This prevents import-time errors.
- **Per-team collections** — Each team gets its own ChromaDB collection named `team_{id}_knowledge`. This ensures complete data isolation.
- **Low temperature (0.3)** — The AI gives factual, grounded answers rather than creative ones.

### 4.2 · `app/rag/processor.py` — Document Processing

Handles the full **Load → Split → Enrich** pipeline:

| Function | Purpose |
|---|---|
| `validate_file(filename, size)` | Checks file type and size before processing |
| `load_document(path, filename)` | Chooses the right LangChain loader (PDF/DOCX/TXT/MD) |
| `split_documents(docs)` | Splits into 800-char chunks with 200-char overlap |
| `enrich_metadata(chunks, ...)` | Tags every chunk with team_id, uploader, etc. |
| `process_document(path, filename, ...)` | Full pipeline for files |
| `process_text(text, title, ...)` | Full pipeline for raw text input |

**Supported file types:**
| Extension | Loader Used |
|---|---|
| `.pdf` | `PyPDFLoader` (extracts per page) |
| `.docx`, `.doc` | `Docx2txtLoader` |
| `.txt` | `TextLoader` |
| `.md` | `TextLoader` |

**Why 800-char chunks with 200-char overlap?**
- **800 chars** is small enough for precise retrieval but large enough to contain meaningful context
- **200 chars overlap** ensures that if a key sentence is split between two chunks, it still appears in full in at least one of them

### 4.3 · `app/rag/prompts.py` — System Prompts

Contains all the text templates the AI uses:

| Template | Used for |
|---|---|
| `SYSTEM_PROMPT` | Defines the AI Brain's personality, rules, and behavior |
| `CONTEXT_TEMPLATE` | Formats the retrieved context + question for GPT-4o |
| `NO_CONTEXT_RESPONSE` | What the AI says when no relevant docs are found |
| `SOURCE_CITATION_TEMPLATE` | How source references are formatted |

**Why separate?** Prompt engineering is iterative. By keeping prompts in their own file, you can tune the AI's behavior without touching any logic code.

### 4.4 · `app/api/v1/rag.py` — API Routes

All 8 endpoints for the AI Brain feature:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/rag/ingest` | POST | Upload files (multipart form). Background processes them. |
| `/api/v1/rag/ingest-text` | POST | Ingest raw text/notes directly |
| `/api/v1/rag/documents/{team_id}` | GET | List all documents in team's knowledge base |
| `/api/v1/rag/documents/{doc_id}` | DELETE | Delete a document + its chunks |
| `/api/v1/rag/stats/{team_id}` | GET | Get knowledge base statistics |
| `/api/v1/rag/chat` | POST | Send a question, get AI response with sources |
| `/api/v1/rag/chat/history/{team_id}` | GET | Get chat history |
| `/api/v1/rag/chat/history/{team_id}` | DELETE | Clear chat history |

**Security:** Every endpoint requires authentication (JWT token) and verifies the user is a member of the specified team.

**Background processing:** File ingestion uses FastAPI's `BackgroundTasks` so the API responds immediately while documents are processed asynchronously. The frontend polls for status updates.

### 4.5 · Database Models

*
Two new tables added to `app/models/user.py`:

**`documents` table — tracks every uploaded file:**
```
id | team_id | uploader_id | filename | stored_path | doc_type | file_size | chunk_count | status | error_message | created_at
```

Statuses: `pending` → `processing` → `ready` (or `error`)

**`chat_messages` table — stores conversation history:**
```
id | team_id | user_id | role | content | sources | created_at
```

Role: `"user"` or `"assistant"`. Sources is a JSON array of source references.

---

## 5 · The Metadata System (Why It Matters)

Every chunk stored in ChromaDB carries this metadata:

```python
{
    "team_id": 1,              # Data isolation
    "document_id": 42,         # Track which document this came from
    "filename": "sprint-3-notes.pdf",  # For source citations
    "uploader_email": "jane@company.com",  # Who added this
    "doc_type": "pdf",         # Filter by type
    "chunk_index": 7,          # Position within the document
    "page_number": 3,          # Which page (for PDFs)
    "uploaded_at": "2026-03-28T22:30:00Z",  # When uploaded
    "source": "sprint-3-notes.pdf"  # Original source ref
}
```

**What you can do with metadata filtering:**
- "Show me only information from PDFs" → `{"doc_type": "pdf"}`
- "What did Jane upload?" → `{"uploader_email": "jane@company.com"}`
- Get a document's specific chunk → `{"document_id": 42, "chunk_index": 7}`

---

## 6 · Frontend — AI Brain Page

The AI Brain page (`/ai-brain`) has three panels:

### Left: Knowledge Base Panel
- **Team Selector** — Switch between teams
- **Upload Zone** — Drag & drop or browse files
- **Stats Bar** — Documents / Chunks / Types
- **Document List** — All uploaded files with status badges, file type icons, and delete buttons
- **Polling** — When documents are `pending`/`processing`, the page auto-polls every 3 seconds

### Center: AI Chat Panel
- **Welcome Screen** — Shows when no messages exist. Has suggestion prompts.
- **Chat Messages** — User and assistant messages with markdown rendering
- **Source Citations** — Shows which documents the AI used to answer
- **Typing Indicator** — Animated dots while AI is thinking
- **Clear History** — Reset the conversation

### Right: Insights Panel
- **Document Types** — Visual bar chart of PDF/DOCX/TXT/etc.
- **Quick Prompts** — Pre-built questions to click and send
- **Activity Feed** — Recent document uploads and their status
- **Brain Status** — Shows active model, embedding model, vector store, top-k

---

## 7 · How Documents Flow Through the System

### Path 1: Via AI Brain Page
1. User drags files onto the upload zone
2. JavaScript sends `POST /api/v1/rag/ingest` with `team_id` + files
3. Backend saves files to `app/static/uploads/rag/`
4. Backend creates `Document` records in PostgreSQL (status: `pending`)
5. Background task kicks off:
   - Status → `processing`
   - `processor.py` loads → splits → enriches the document
   - `engine.py` embeds and stores chunks in ChromaDB
   - Status → `ready` (or `error`)
6. Frontend polls `GET /api/v1/rag/documents/{team_id}` every 3 seconds
7. When status changes to `ready`, the document appears with a ✅

### Path 2: Via Team Creation (Onboarding Step 3)
1. Same file upload (the onboarding page now sends `team_id` with uploads)
2. Files go through the same RAG pipeline automatically
3. Documents appear in the AI Brain when the user visits it later

---

## 8 · How Chat Works (The Full Flow)

1. User types a question in the chat input
2. JavaScript sends `POST /api/v1/rag/chat` with:
   ```json
   { "team_id": 1, "message": "What decisions were made in sprint 3?" }
   ```
3. Backend:
   a. Loads last 20 chat messages from DB (for context)
   b. Calls `rag_engine.search()` — finds top 5 most similar chunks
   c. Assembles context with source info
   d. Builds message chain: System Prompt + History + Context + Question
   e. Calls GPT-4o
   f. Saves both user message and AI response to `chat_messages` table
4. Response includes:
   ```json
   {
     "response": "In sprint 3, the team decided to...",
     "sources": [
       {"filename": "sprint-3-notes.pdf", "page_number": 2, "uploader": "jane@co.com"}
     ],
     "chunk_count": 5
   }
   ```
5. Frontend renders the message with source citations

---

## 9 · Environment Variables (New)

Added to `.env`:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required. Your OpenAI API key for embeddings + chat |

Added to `app/core/config.py` (with defaults):

| Setting | Default | Purpose |
|---|---|---|
| `RAG_CHUNK_SIZE` | 800 | Characters per chunk |
| `RAG_CHUNK_OVERLAP` | 200 | Overlap between chunks |
| `RAG_EMBEDDING_MODEL` | text-embedding-3-small | OpenAI embedding model |
| `RAG_CHAT_MODEL` | gpt-4o | OpenAI chat model |
| `RAG_TOP_K` | 5 | Number of chunks to retrieve |
| `CHROMA_PERSIST_DIR` | ./chroma_data | Where ChromaDB stores vectors |

---

## 10 · New Python Dependencies

| Package | Why |
|---|---|
| `langchain` | Orchestration framework for the RAG pipeline |
| `langchain-openai` | OpenAI integration (embeddings + chat) |
| `langchain-chroma` | ChromaDB integration for LangChain |
| `langchain-community` | Community document loaders (PDF, DOCX, etc.) |
| `chromadb` | Vector database for storing embeddings |
| `openai` | OpenAI Python SDK |
| `pypdf` | PDF text extraction |
| `python-docx` | DOCX file reading |
| `docx2txt` | Alternative DOCX loader |
| `tiktoken` | Token counting for OpenAI models |

---

## 11 · Extending the System (Future Ideas)

- **Agentic workflows** — Use LangGraph for multi-step reasoning
- **Auto-ingestion** — Connect Google Drive, Miro, GitHub for auto-sync
- **Re-ranking** — Add a Cross-Encoder re-ranker for better precision
- **Hybrid search** — Combine vector similarity with BM25 keyword search
- **Streaming responses** — Stream GPT-4o responses token-by-token
- **Multi-modal** — Process images with GPT-4o Vision

---

*Last updated: 2026-03-28*
