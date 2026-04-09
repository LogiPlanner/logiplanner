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
                                   # POST /rag/ingest            (upload files)
                                   # POST /rag/ingest-text       (ingest raw text)
                                   # POST /rag/ingest-url        (ingest any public URL)
                                   # POST /rag/ingest-drive      (ingest Google Drive URL)
                                   # POST /rag/ingest-github     (ingest GitHub file/repo)
                                   # GET  /rag/documents/{team_id}      (list docs)
                                   # GET  /rag/documents/{doc_id}/detail
                                   # GET  /rag/documents/{doc_id}/chunks
                                   # POST /rag/documents/{doc_id}/refresh (re-sync Drive doc)
                                   # DELETE /rag/documents/{doc_id}
                                   # GET  /rag/stats/{team_id}  (knowledge base stats)
                                   # GET  /rag/recent-chunks/{team_id}
                                   # GET  /rag/my-role/{team_id}
                                   # POST /rag/chat              (AI Brain chat)
                                   # GET  /rag/chat/history/{team_id}
                                   # GET  /rag/chat/sessions/{team_id}
                                   # DELETE /rag/chat/history/{team_id}

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
| `chat(team_id, query, history, filters, live_context)` | Full RAG pipeline: search → context + live DB snapshot → GPT-4o → response with sources |
| `get_stats(team_id)` | Returns document count, chunk count, type breakdown |

**`chat()` signature:**
```python
def chat(
    self,
    team_id: int,
    query: str,
    chat_history: Optional[List[Dict[str, str]]] = None,
    filters: Optional[Dict[str, Any]] = None,
    live_context: Optional[str] = None,   # NEW: pre-built DB snapshot from API layer
) -> Dict[str, Any]:
```

The `live_context` parameter receives a pre-assembled plain-text or `__CARDS__:` JSON string built by `rag.py` from live DB queries (calendar tasks, timeline entries). It is injected into the system prompt alongside ChromaDB retrieval context, so the LLM sees both the document knowledge base and the live workspace state.

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

All 18 endpoints for the AI Brain feature:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/rag/ingest` | POST | Upload files (multipart). Background processes them. |
| `/api/v1/rag/ingest-text` | POST | Ingest raw text/notes directly |
| `/api/v1/rag/ingest-url` | POST | Ingest any public URL |
| `/api/v1/rag/ingest-drive` | POST | Ingest a Google Drive file/folder |
| `/api/v1/rag/ingest-github` | POST | Ingest a GitHub file or repo (uses `GitPython`, `GITHUB_TOKEN`) |
| `/api/v1/rag/documents/{team_id}` | GET | List all documents in team's knowledge base |
| `/api/v1/rag/documents/{doc_id}/detail` | GET | Get a single document's details |
| `/api/v1/rag/documents/{doc_id}/chunks` | GET | View stored chunks for a document |
| `/api/v1/rag/documents/{doc_id}/refresh` | POST | Re-sync a Google Drive document |
| `/api/v1/rag/documents/{doc_id}` | DELETE | Delete a document + its chunks |
| `/api/v1/rag/stats/{team_id}` | GET | Get knowledge base statistics |
| `/api/v1/rag/recent-chunks/{team_id}` | GET | List recently added knowledge items |
| `/api/v1/rag/my-role/{team_id}` | GET | Get current user's role for this team |
| `/api/v1/rag/chat` | POST | AI Brain chat (RAG + live context) |
| `/api/v1/rag/chat/history/{team_id}` | GET | Get chat message history |
| `/api/v1/rag/chat/sessions/{team_id}` | GET | List all chat sessions |
| `/api/v1/rag/chat/history/{team_id}` | DELETE | Clear chat history |

**Security:** Every endpoint requires authentication (JWT) and `_verify_team_access()` to confirm the user is a team member. Write operations (ingest, delete) additionally require `_require_editor_or_owner()` — `viewer` role users cannot modify the knowledge base.

**Intent classification (short-circuit):** Before calling the RAG engine, `rag.py` classifies the query:
- `_is_task_query(message)` → calls `_build_live_task_summary()` → returns `__CARDS__:` JSON directly, **no LLM call**
- `_is_timeline_query(message)` → calls `_build_live_timeline_summary()` → returns `__CARDS__:` JSON directly, **no LLM call**
- Otherwise → passes `live_context` string into `rag_engine.chat()` for full RAG pipeline

**Background processing:** File ingestion uses FastAPI's `BackgroundTasks` so the API responds immediately while documents are processed asynchronously. The frontend polls for status updates.

### 4.5 · Database Models

Tables now defined across multiple model files (all share the same `Base`):

**`documents` table — tracks every uploaded/ingested source:**
```
id | team_id | uploader_id | filename | stored_path (nullable)
   | doc_type | file_size | chunk_count | status | error_message
   | source_url | drive_file_id | last_synced_at | refresh_interval_hours
   | folder_id (self-ref FK for folder hierarchy) | summary (LLM-generated)
   | created_at
```
Statuses: `pending` → `processing` → `ready` (or `error`). `stored_path` is nullable — files are deleted from disk after processing; only ChromaDB vectors persist.

**`chat_messages` table — stores conversation history:**
```
id | team_id | user_id | session_id | role | content | sources | created_at
```
`role`: `"user"` or `"assistant"`. `sources`: JSON array of source references. `session_id`: groups messages into named sessions for per-session history views.

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

### Path 1: Via AI Brain Page (file upload)
1. User drags files onto the upload zone
2. JavaScript sends `POST /api/v1/rag/ingest` with `team_id` + files
3. Backend saves files temporarily to `app/static/uploads/rag/`
4. Backend creates `Document` records in PostgreSQL (status: `pending`)
5. Background task kicks off:
   - Status → `processing`
   - `processor.py` loads → splits → enriches the document
   - LLM generates a one-sentence `summary` for the document
   - `engine.py` embeds and stores chunks in ChromaDB
   - Status → `ready` (or `error`)
   - **File is deleted from disk** (we only keep embeddings in ChromaDB)
6. Frontend polls `GET /api/v1/rag/documents/{team_id}` every 3 seconds
7. When status changes to `ready`, the document appears with a ✅

> **Note:** Uploaded files are ephemeral — they are deleted from disk immediately
> after processing (success or failure). Only the embeddings in ChromaDB persist.

### Path 2: Via URL / Google Drive / GitHub Ingestion
1. User submits a URL via `POST /api/v1/rag/ingest-url`, `/ingest-drive`, or `/ingest-github`
2. Source URL is stored in `document.source_url` (and `drive_file_id` for Drive docs)
3. Content is fetched, chunked, and embedded as normal
4. Drive documents track `last_synced_at` and can be re-synced via `/documents/{doc_id}/refresh`
5. GitHub ingestion clones/reads the repo using `GitPython` (optional `GITHUB_TOKEN` for private repos)

### Path 3: Via Team Creation (Onboarding Step 3)
1. Same file upload (the onboarding page sends `team_id` with uploads)
2. Files go through the same RAG pipeline automatically
3. Documents appear in the AI Brain when the user visits it later

### Startup Recovery
On every server start, `app/main.py`'s startup event scans for documents stuck in `pending` or `processing` (from a crash) and marks them as `error` so users can see they failed and retry.

---

## 8 · How Chat Works (The Full Flow)

1. User types a question in the chat input
2. JavaScript sends `POST /api/v1/rag/chat` with:
   ```json
   { "team_id": 1, "message": "What decisions were made in sprint 3?" }
   ```
3. API layer runs **intent classification** first:
   - If it matches task/calendar keywords → queries DB directly, returns `__CARDS__:` JSON (no LLM)
   - If it matches timeline/memory keywords → queries DB directly, returns `__CARDS__:` JSON (no LLM)
   - Otherwise → continues to full RAG pipeline
4. Full RAG pipeline (when no short-circuit):
   - Loads last 20 chat messages from DB (for conversation context)
   - Calls `rag_engine.search()` — finds top 5 most similar chunks
   - Assembles `live_context` string (tasks + timeline DB snapshot)
   - Builds message chain: System Prompt + Live Context + KB Context + History + Question
   - Calls GPT-4o
   - Saves both user message and AI response to `chat_messages` table with `session_id`
5. Response includes:
   ```json
   {
     "response": "In sprint 3, the team decided to...",
     "sources": [
       {"filename": "sprint-3-notes.pdf", "page_number": 2, "uploader": "jane@co.com"}
     ],
     "chunk_count": 5
   }
   ```
   OR for short-circuited intent responses:
   ```
   __CARDS__: [{"type": "calendar", "heading": "Your Tasks", "items": [...]}]
   ```
6. Frontend (`ai-brain.js`) detects the `__CARDS__:` prefix and renders structured card UI instead of plain text

---

## 8.1 · The `__CARDS__` Response Format

When the AI Brain returns structured workspace data, it prefixes the response with `__CARDS__:` followed by a JSON array. The frontend (`ai-brain.js`) detects this prefix, parses the JSON, and renders interactive card UI instead of plain text.

Three card types are supported:

### `calendar` card
```json
{
  "type": "calendar",
  "heading": "Your Tasks This Week",
  "url": "/dashboard",
  "items": [
    {
      "title": "Sprint Planning",
      "priority": "high",
      "start": "2026-04-11T10:00:00",
      "end": "2026-04-11T11:00:00",
      "location": "Conference Room B"
    }
  ]
}
```

### `timeline` card
```json
{
  "type": "timeline",
  "heading": "Recent Decisions",
  "url": "/memory",
  "items": [
    {
      "entry_type": "decision",
      "title": "Chose PostgreSQL over MongoDB",
      "project": "Platform v2",
      "date": "2026-04-01",
      "content": "Team voted unanimously for relational DB..."
    }
  ]
}
```

### `workspace` card
```json
{
  "type": "workspace",
  "heading": "Project Overview",
  "url": "/dashboard",
  "items": [
    {
      "badge": "Milestone",
      "title": "Beta Launch",
      "meta": "Due April 30",
      "secondary": "High impact",
      "description": "Public beta with 50 pilot users",
      "cta": "View on Timeline",
      "href": "/memory"
    }
  ]
}
```

The card response must be **immediately followed by valid JSON** — no markdown code fences. Responses starting with `__CARDS__:` are never saved as plain-text chat messages; the frontend renders and discards the JSON after display.

---

## 9 · Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required. OpenAI API key for embeddings, GPT-4o chat, and Whisper audio transcription |
| `GITHUB_TOKEN` | Optional. GitHub PAT for ingesting private repositories |
| `RAG_CHUNK_SIZE` | Characters per chunk (default: 800) |
| `RAG_CHUNK_OVERLAP` | Overlap between chunks in chars (default: 200) |
| `RAG_EMBEDDING_MODEL` | OpenAI embedding model (default: `text-embedding-3-small`) |
| `RAG_CHAT_MODEL` | OpenAI chat model (default: `gpt-4o`) |
| `RAG_TOP_K` | Number of chunks to retrieve per query (default: 5) |
| `CHROMA_PERSIST_DIR` | Where ChromaDB stores vectors (default: `./chroma_data`) |

---

## 10 · Python Dependencies

| Package | Why |
|---|---|
| `langchain` | Orchestration framework for the RAG pipeline |
| `langchain-openai` | OpenAI integration (embeddings + chat) |
| `langchain-chroma` | ChromaDB integration for LangChain |
| `langchain-community` | Community document loaders (PDF, DOCX, etc.) |
| `chromadb` | Vector database for storing embeddings |
| `openai` | OpenAI Python SDK (also used for Whisper transcription) |
| `pypdf` | PDF text extraction |
| `python-docx` | DOCX file reading |
| `docx2txt` | Alternative DOCX loader |
| `tiktoken` | Token counting for OpenAI models |
| `GitPython` | Clone / read GitHub repos for RAG ingestion |

---

## 11 · Extending the System (Future Ideas)

- **Agentic workflows** — Use LangGraph for multi-step reasoning
- **Jira / Slack integration** — Ingest issues/comments, post AI summaries to Slack
- **Re-ranking** — Add a Cross-Encoder re-ranker for better precision
- **Hybrid search** — Combine vector similarity with BM25 keyword search
- **Streaming responses** — Stream GPT-4o responses token-by-token to the frontend
- **Multi-modal** — Process images with GPT-4o Vision
- **Auto-sync scheduling** — Cron-based re-sync for Google Drive docs based on `refresh_interval_hours`

---

*Last updated: 2026-04-10*
