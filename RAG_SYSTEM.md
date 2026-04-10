# LogiPlanner RAG System -- Complete Documentation

> **Purpose:** Explain every aspect of the RAG (Retrieval-Augmented Generation) system so you can understand, modify, and extend it confidently.

---

## 1. What Is RAG and Why We Built It

**RAG (Retrieval-Augmented Generation)** is a technique where an AI model answers questions by first *retrieving* relevant documents from a knowledge base, then *generating* a response grounded in those documents -- instead of making up answers from its general training data.

### Why RAG is perfect for LogiPlanner

LogiPlanner's core value proposition is: *"Notion AI guesses what happened. LogiPlanner **knows** what happened because a human verifies it."*

RAG makes this real:
- Every AI answer is **grounded in documents that humans have uploaded and verified**
- The AI **cites its sources** (which file, which page) -- fully traceable
- Each team's data is **isolated** -- Team A can never see Team B's documents
- **No hallucinations** -- if the knowledge base doesn't have the answer, the AI says so honestly

---

## 2. Architecture Overview

```
USER UPLOADS A PDF
     |
     v
+-------------------------------------------------------------+
|  PROCESSOR  (app/rag/processor.py)                          |
|                                                             |
|  1. LOAD: PyPDFLoader / TextLoader / Docx reads the file    |
|  2. SPLIT: RecursiveCharacterTextSplitter chops it into     |
|     800-character chunks with 200-char overlap              |
|  3. SUMMARIZE: GPT-4o-mini generates a 1-line summary of    |
|     the full document (called before ingest in rag.py)      |
|  4. ENRICH: Each chunk gets tagged with metadata:           |
|     * team_id, document_id, uploader_email                  |
|     * filename, doc_type, page_number, chunk_index          |
|     * uploaded_at (ISO timestamp)                           |
|     * doc_summary (same 1-line summary on every chunk)      |
|  5. HEADER: [Document: name] [Summary: ...] prepended to    |
|     chunk text so the embedding captures document context   |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|  ENGINE  (app/rag/engine.py) -- INGESTION                   |
|                                                             |
|  6. EMBED: Local BAAI/bge-base-en-v1.5 (HuggingFace)       |
|     converts each chunk into a 768-dimensional vector       |
|     (free, runs on CPU, no API key needed)                  |
|  7. STORE: ChromaDB saves the vector + metadata              |
|     in a per-team collection (team_1_knowledge, etc.)       |
+-------------------------------------------------------------+
                              |
                              v
                   LOCAL ./chroma_data/ FOLDER
                   (survives server restarts)


USER ASKS A QUESTION
     |
     v
+-------------------------------------------------------------+
|  ENGINE -> SEARCH  (Hybrid Retrieval Pipeline)              |
|                                                             |
|  1. CONVERSATION-AWARE HYDE: GPT-4o-mini expands the query  |
|     into a hypothetical document excerpt, using the last 3  |
|     chat turns for context (resolves follow-up references)  |
|                                                             |
|  2. MULTI-QUERY: GPT-4o-mini generates 3 paraphrases of     |
|     the original question for diverse candidate coverage    |
|                                                             |
|  3. VECTOR SEARCH: Run similarity search for each query     |
|     variant (HyDE-expanded + 3 paraphrases = 4 searches)    |
|                                                             |
|  4. BM25 KEYWORD SEARCH: Run exact keyword search over all  |
|     chunks to catch names, IDs, acronyms semantic search    |
|     misses                                                  |
|                                                             |
|  5. RECIPROCAL RANK FUSION: Merge all 5 result lists,       |
|     de-duplicate, re-rank by combined 1/(k+rank) scores     |
|                                                             |
|  6. CROSS-ENCODER RERANK: Local BAAI/bge-reranker-base      |
|     scores every (original-query, chunk) pair precisely     |
|     and returns top-K results                               |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|  ENGINE -> CHAT                                             |
|                                                             |
|  7. Assemble context: retrieved chunks with doc_summary     |
|     labels in source citations                              |
|  8. Build prompt: System prompt + Live DB snapshot +        |
|     KB context + chat history (last 10 exchanges) +         |
|     the user's question                                     |
|  9. Send to GPT-5.2 (main answer model)                     |
|  10. Return the answer + source citations                   |
+-------------------------------------------------------------+
```

---

## 3. Folder Structure

```
app/rag/                           <- RAG SYSTEM (THE BRAINS)
|-- __init__.py                    # Package docstring
|-- engine.py                      # RAG engine: ChromaDB + HuggingFace + OpenAI orchestration
|-- processor.py                   # Document loading, splitting, metadata enrichment, headers
+-- prompts.py                     # AI system prompts and templates

app/api/v1/rag.py                  <- API ROUTES
                                   # POST /rag/ingest            (upload files)
                                   # POST /rag/ingest-text       (ingest raw text)
                                   # POST /rag/ingest-url        (ingest any public URL)
                                   # POST /rag/ingest-drive      (ingest Google Drive URL)
                                   # POST /rag/ingest-github     (ingest GitHub file/repo)
                                   # GET  /rag/documents/{team_id}
                                   # GET  /rag/documents/{doc_id}/detail
                                   # GET  /rag/documents/{doc_id}/chunks
                                   # POST /rag/documents/{doc_id}/refresh
                                   # DELETE /rag/documents/{doc_id}
                                   # GET  /rag/stats/{team_id}
                                   # GET  /rag/recent-chunks/{team_id}
                                   # GET  /rag/my-role/{team_id}
                                   # POST /rag/chat
                                   # GET  /rag/chat/history/{team_id}
                                   # GET  /rag/chat/sessions/{team_id}
                                   # DELETE /rag/chat/history/{team_id}

app/schemas/rag.py                 <- PYDANTIC SCHEMAS
app/models/user.py                 <- DATABASE MODELS (Document, ChatMessage)
app/templates/ai-brain.html        <- HTML PAGE (3-panel layout)
app/static/ai-brain/css/           <- STYLES (dark glassmorphism)
app/static/ai-brain/js/ai-brain.js <- FRONTEND LOGIC (upload, chat, stats, __CARDS__ renderer)

chroma_data/                       <- VECTOR DATABASE (auto-created, gitignored)
app/static/uploads/rag/            <- UPLOADED FILES (ephemeral, gitignored)
```

---

## 4. Each File Explained in Detail

### 4.1. `app/rag/engine.py` -- The RAG Engine

Singleton class (`rag_engine`) that manages the entire pipeline. Lazy-initialized on first use.

| Method | What it does |
|---|---|
| `_ensure_initialized()` | Loads embeddings model, reranker, expansion LLM, chat LLM, connects ChromaDB |
| `_expand_query(query, chat_history)` | Conversation-aware HyDE: GPT-4o-mini generates a hypothetical document excerpt using last 3 chat turns |
| `_generate_multi_queries(query)` | GPT-4o-mini generates `RAG_MULTI_QUERY_COUNT` paraphrases (default: 3) |
| `_bm25_search(team_id, query, k)` | Keyword search over all chunks using BM25Okapi; catches exact matches |
| `_reciprocal_rank_fusion(result_lists)` | Merges multiple ranked lists via RRF; de-duplication by page content |
| `ingest_chunks(team_id, chunks)` | Stores pre-processed chunks in the team's ChromaDB collection |
| `delete_document_chunks(team_id, doc_id)` | Removes all chunks for a deleted document |
| `search(team_id, query, k, filters, chat_history)` | Full hybrid retrieval: HyDE + multi-query + vector + BM25 + RRF + cross-encoder rerank |
| `chat(team_id, query, history, filters, live_context)` | Full RAG pipeline -> GPT-5.2 -> response with sources |
| `invoke_expansion(messages)` | Retry wrapper for the cheap GPT-4o-mini LLM (used by rag.py for doc summaries) |
| `_invoke_llm_with_retry(messages)` | Retry wrapper for the main GPT-5.2 chat LLM |
| `get_stats(team_id)` | Returns document count, chunk count, type breakdown |
| `get_recent_chunks(team_id, limit, db)` | Fast-path recent chunks query using SQL + targeted ChromaDB lookups |

**Key design decisions:**
- **Per-team collections** -- `team_{id}_knowledge` ensures complete data isolation
- **Local embeddings + reranker** -- Zero embedding API cost; models cached at `~/.cache/huggingface/` after first run
- **Two LLMs** -- GPT-4o-mini for cheap tasks (expansion, paraphrasing, summarization); GPT-5.2 for final answers
- **Original query for reranking** -- The cross-encoder always uses the user's original question (not the HyDE excerpt) to accurately score relevance
- **BM25 over full corpus** -- Loads all chunk texts from ChromaDB on each search; fast enough for typical team knowledge bases (thousands of chunks)

### 4.2. `app/rag/processor.py` -- Document Processing

Handles the full **Load -> Split -> Enrich** pipeline:

| Function | Purpose |
|---|---|
| `validate_file(filename, size)` | Checks file type and size before processing |
| `load_document(path, filename)` | Chooses the right LangChain loader (PDF/DOCX/TXT/MD) |
| `split_documents(docs)` | Splits into 800-char chunks with 200-char overlap |
| `enrich_metadata(chunks, ..., doc_summary)` | Tags every chunk with metadata + adds contextual header to chunk text |
| `process_document(path, filename, ...)` | Full pipeline for uploaded files |
| `process_text(text, title, ...)` | Full pipeline for raw text input |

**Supported file types:**
| Extension | Loader Used |
|---|---|
| `.pdf` | `PyPDFLoader` (extracts per page) |
| `.docx`, `.doc` | `python-docx` + custom parser |
| `.txt` | `TextLoader` |
| `.md` | `TextLoader` |

**Contextual chunk headers (`RAG_CONTEXTUAL_HEADERS=True`):**
Before storing, every chunk's text is prefixed with:
```
[Document: sprint-3-notes.pdf] [Summary: Sprint 3 planning notes covering task assignments and blockers]

...original chunk text...
```
This bakes document-level context into the embedding vector itself -- not just metadata -- so even a bare table of numbers retrieves correctly when searching for its parent document topic.

**Why 800-char chunks with 200-char overlap?**
- **800 chars** is small enough for precise retrieval but large enough to contain meaningful context
- **200 chars overlap** ensures sentences split across chunk boundaries still appear in full in at least one chunk

### 4.3. `app/rag/prompts.py` -- System Prompts

| Template | Used for |
|---|---|
| `SYSTEM_PROMPT` | Defines the AI Brain's personality, rules, and behavior |
| `CONTEXT_TEMPLATE` | Formats retrieved KB context + live DB snapshot + question for GPT-5.2 |
| `NO_CONTEXT_RESPONSE` | What the AI says when no relevant docs are found |
| `SOURCE_CITATION_TEMPLATE` | How source references are formatted |

**Why separate?** Prompt engineering is iterative. Keeping prompts in their own file lets you tune AI behavior without touching logic code.

### 4.4. `app/api/v1/rag.py` -- API Routes

All endpoints for the AI Brain feature. Security: every endpoint requires JWT auth and `_verify_team_access()`. Write operations additionally require `_require_editor_or_owner()` -- `viewer` role cannot modify the knowledge base.

**Document ingestion flow (all 5 ingest endpoints):**
```python
# ORDER MATTERS -- summary is generated BEFORE ingest so doc_summary
# lands in ChromaDB metadata on every chunk
summary = _generate_doc_summary(chunks, filename)  # GPT-4o-mini (cheap)
for c in chunks:
    c.metadata["doc_summary"] = summary            # stamp on every chunk
chunk_count = rag_engine.ingest_chunks(team_id, chunks)  # then store
```

**Intent classification (short-circuit before RAG):**
- `_is_task_query(message)` -> queries DB directly -> returns `__CARDS__:` JSON, no LLM call
- `_is_timeline_query(message)` -> queries DB directly -> returns `__CARDS__:` JSON, no LLM call
- Otherwise -> full RAG pipeline with `live_context` passed to `rag_engine.chat()`

**Background processing:** File uploads use FastAPI `BackgroundTasks` -- API responds immediately, processing is async. Frontend polls for status.

### 4.5. Database Models

**`documents` table:**
```
id | team_id | uploader_id | filename | stored_path (nullable, deleted post-ingest)
   | doc_type | file_size | chunk_count | status | error_message
   | source_url | drive_file_id | last_synced_at | refresh_interval_hours
   | folder_id (self-ref FK) | summary (LLM-generated 1-line, GPT-4o-mini)
   | created_at
```
Statuses: `pending` -> `processing` -> `ready` (or `error`).

**`chat_messages` table:**
```
id | team_id | user_id | session_id | role | content | sources | created_at
```
`role`: `"user"` or `"assistant"`. `sources`: JSON array. `session_id`: groups into named sessions.

---

## 5. The Metadata System

Every chunk stored in ChromaDB carries this metadata:

```python
{
    "team_id": 1,
    "document_id": 42,
    "filename": "sprint-3-notes.pdf",
    "uploader_email": "jane@company.com",
    "doc_type": "pdf",
    "chunk_index": 7,
    "page_number": 3,
    "uploaded_at": "2026-04-10T12:00:00Z",
    "source": "sprint-3-notes.pdf",
    "doc_summary": "Sprint 3 planning notes covering task assignments and blockers",
}
```

**`doc_summary` on every chunk** -- the same 1-line summary is stamped on every chunk of a document. This means any retrieved chunk (even a bare table of numbers page 12) carries the document's full topic, giving GPT-5.2 context to ground its answer.

In source citations shown to GPT-5.2:
```
[Source 1: sprint-3-notes.pdf -- "Sprint 3 planning notes covering task assignments" (Page 3)]
```

**Metadata filtering (ChromaDB `where` clause):**
- Only PDFs: `{"doc_type": "pdf"}`
- One uploader: `{"uploader_email": "jane@company.com"}`
- Specific document: `{"document_id": 42}`

---

## 6. Frontend -- AI Brain Page

The AI Brain page (`/ai-brain`) has three panels:

### Left: Knowledge Base Panel
- **Team Selector** -- Switch between teams
- **Upload Zone** -- Drag & drop or browse files
- **Stats Bar** -- Documents / Chunks / Types
- **Document List** -- All uploaded files with status badges, file type icons, and delete buttons
- **Polling** -- When documents are `pending`/`processing`, the page auto-polls every 3 seconds

### Center: AI Chat Panel
- **Welcome Screen** -- Shows when no messages exist. Has suggestion prompts.
- **Chat Messages** -- User and assistant messages with markdown rendering
- **Source Citations** -- Shows which documents the AI used to answer
- **Typing Indicator** -- Animated dots while AI is thinking
- **Clear History** -- Reset the conversation

### Right: Insights Panel
- **Document Types** -- Visual bar chart of PDF/DOCX/TXT/etc.
- **Quick Prompts** -- Pre-built questions to click and send
- **Activity Feed** -- Recent document uploads and their status
- **Brain Status** -- Shows active model, embedding model, vector store, top-k

---

## 7. How Documents Flow Through the System

### Path 1: Via AI Brain Page (file upload)
1. User drags files onto the upload zone
2. JavaScript sends `POST /api/v1/rag/ingest` with `team_id` + files
3. Backend saves files temporarily to `app/static/uploads/rag/`
4. Backend creates `Document` records in PostgreSQL (status: `pending`)
5. Background task:
   - Status -> `processing`
   - `processor.py` loads -> splits -> enriches chunks (with contextual headers)
   - `_generate_doc_summary()` calls GPT-4o-mini to make a 1-line summary
   - Summary is stamped on every chunk's `doc_summary` metadata field
   - `engine.py` embeds (local BAAI model) and stores in ChromaDB
   - Status -> `ready` (or `error`)
   - **File deleted from disk** -- only ChromaDB vectors persist
6. Frontend polls every 3 seconds until status is `ready`

### Path 2: Via URL / Google Drive / GitHub Ingestion
1. User submits a URL via `/ingest-url`, `/ingest-drive`, or `/ingest-github`
2. Content is fetched, chunked, summarised, and embedded
3. Drive documents track `last_synced_at` and can be re-synced via `/documents/{doc_id}/refresh`
4. GitHub ingestion reads repos using `GitPython` (optional `GITHUB_TOKEN` for private repos)

### Path 3: Via Team Creation (Onboarding)
Same pipeline -- the onboarding page sends `team_id` with uploads. Documents appear in the AI Brain automatically.

### Startup Recovery
On every server start, any document stuck `pending`/`processing` (from a crash) is marked `error` so users know to retry.

---

## 8. How Chat Works (The Full Flow)

1. User types a question; JavaScript sends `POST /api/v1/rag/chat`
2. **Intent classification** (short-circuit):
   - Task/calendar keywords -> DB query -> `__CARDS__:` JSON (no LLM)
   - Timeline/memory keywords -> DB query -> `__CARDS__:` JSON (no LLM)
   - Otherwise -> full hybrid RAG pipeline
3. **Hybrid retrieval** (`engine.search()`):
   ```
   a. Conversation-aware HyDE -- GPT-4o-mini generates hypothetical excerpt
      using current query + last 3 chat turns
   b. Multi-query -- GPT-4o-mini generates 3 paraphrases of the original
   c. Vector search -- runs for HyDE-expanded query + 3 paraphrases (4 total)
   d. BM25 search -- keyword search on original query over full corpus
   e. RRF -- merge all 5 result lists, deduplicate, fuse scores
   f. Cross-encoder reranking -- BAAI/bge-reranker-base scores each
      (original-query, chunk) pair; returns top-K
   ```
4. Assemble `live_context` string from live DB (tasks + timeline snapshot)
5. Build message chain: `System Prompt` + `KB Context + Live Context` + `Chat History (last 10)` + `Question`
6. Call **GPT-5.2** (main answer model)
7. Save user + assistant messages to `chat_messages` with `session_id`
8. Return:
   ```json
   {
     "response": "In sprint 3, the team decided to...",
     "sources": [
       {"filename": "sprint-3-notes.pdf", "page_number": 2, "uploader": "jane@co.com",
        "doc_summary": "Sprint 3 planning notes..."}
     ],
     "chunk_count": 5
   }
   ```

---

## 8.1. The `__CARDS__` Response Format

When the AI Brain returns structured workspace data, it prefixes with `__CARDS__:` followed by a JSON array. The frontend (`ai-brain.js`) renders interactive card UI instead of plain text.

Three card types:

### `calendar` card
```json
{
  "type": "calendar",
  "heading": "Your Tasks This Week",
  "url": "/dashboard",
  "items": [
    { "title": "Sprint Planning", "priority": "high",
      "start": "2026-04-11T10:00:00", "end": "2026-04-11T11:00:00" }
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
    { "entry_type": "decision", "title": "Chose PostgreSQL over MongoDB",
      "project": "Platform v2", "date": "2026-04-01", "content": "..." }
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
    { "badge": "Milestone", "title": "Beta Launch", "meta": "Due April 30",
      "description": "Public beta with 50 pilot users", "cta": "View", "href": "/memory" }
  ]
}
```

---

## 9. Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI key for GPT-4o-mini + GPT-5.2 | -- (required) |
| `GITHUB_TOKEN` | GitHub PAT for private repos | optional |
| `RAG_CHUNK_SIZE` | Characters per chunk | `800` |
| `RAG_CHUNK_OVERLAP` | Overlap between chunks | `200` |
| `RAG_CHAT_MODEL` | Main answer model | `gpt-5.2` |
| `RAG_EXPANSION_MODEL` | Cheap model for expansion, paraphrase, summaries | `gpt-4o-mini` |
| `RAG_QUERY_EXPANSION` | Enable HyDE query expansion | `True` |
| `RAG_MULTI_QUERY` | Enable multi-query paraphrase retrieval | `True` |
| `RAG_MULTI_QUERY_COUNT` | Number of paraphrases to generate | `3` |
| `RAG_BM25_WEIGHT` | Enable BM25 in hybrid search (0 = off) | `0.3` |
| `RAG_CONTEXTUAL_HEADERS` | Prepend doc title+summary to chunk text at ingest | `True` |
| `RAG_TOP_K` | Chunks to return after reranking | `5` |
| `RAG_RERANK_FETCH_MULTIPLIER` | Candidate pool = TOP_K * multiplier | `5` |
| `CHROMA_PERSIST_DIR` | ChromaDB storage path | `./chroma_data` |
| `HF_EMBEDDING_MODEL` | Local embedding model (HuggingFace) | `BAAI/bge-base-en-v1.5` |
| `HF_RERANKER_MODEL` | Local cross-encoder reranker (HuggingFace) | `BAAI/bge-reranker-base` |

---

## 10. Python Dependencies

| Package | Why |
|---|---|
| `langchain` | Orchestration framework for the RAG pipeline |
| `langchain-openai` | OpenAI integration (GPT-4o-mini + GPT-5.2) |
| `langchain-huggingface` | HuggingFace embeddings integration |
| `langchain-chroma` | ChromaDB integration for LangChain |
| `langchain-community` | Community document loaders (PDF, DOCX, etc.) |
| `chromadb` | Vector database for storing embeddings |
| `openai` | OpenAI Python SDK |
| `sentence-transformers` | Local cross-encoder reranker (BAAI/bge-reranker-base) |
| `rank_bm25` | BM25 keyword search for hybrid retrieval |
| `pypdf` | PDF text extraction |
| `python-docx` | DOCX file reading |
| `tiktoken` | Token counting for OpenAI models |
| `GitPython` | Clone / read GitHub repos for RAG ingestion |

**Local model storage:** HuggingFace models are cached at `~/.cache/huggingface/hub/` after the first download. No re-download needed across restarts.

---

## 11. Extending the System (Future Ideas)

- **Streaming responses** -- Stream GPT-5.2 tokens to the frontend via SSE/WebSocket
- **Multi-modal** -- Process images and diagrams with GPT-4o Vision
- **Auto-sync scheduling** -- Cron-based re-sync for Google Drive docs based on `refresh_interval_hours`
- **Agentic workflows** -- Use LangGraph for multi-step reasoning (e.g., research -> summarise -> action)
- **Jira / Slack integration** -- Ingest issues/comments; post AI summaries back to Slack
- **Per-document BM25 index** -- Cache BM25 index per team in memory to avoid rebuilding on every query
- **MMR (Maximal Marginal Relevance)** -- Increase result diversity by penalising near-duplicate chunks post-rerank

---

*Last updated: 2026-04-10*
