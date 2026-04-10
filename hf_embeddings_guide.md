# HuggingFace Local Embeddings — Integration Guide

> This document explains the local embedding integration added to LogiPlanner, what changed, and what every developer needs to do.

---

## What Changed

LogiPlanner's RAG system (AI Brain) previously used **OpenAI `text-embedding-3-small`** for all document embeddings. Every time a document was ingested or a search query ran, it made a paid API call to OpenAI.

We replaced the embedding layer with **`BAAI/bge-base-en-v1.5`** — a local HuggingFace model that runs entirely on your CPU. No API calls, no cost, no network needed after the first download.

### What's the same (unchanged)
- **Chat LLM**: Still GPT-4o via OpenAI (requires `OPENAI_API_KEY`)
- **Whisper**: Audio transcription in meetings still uses OpenAI
- **ChromaDB**: Still the vector store — same persistent storage
- **All features**: Dashboard, timeline, calendar, meetings, onboarding — nothing changes
- **All frontend code**: Zero changes

### What's different
| Before | After |
|---|---|
| OpenAI `text-embedding-3-small` (1536-dim) | Local `BAAI/bge-base-en-v1.5` (768-dim) |
| Paid per API call | Free — runs on CPU |
| Requires network for every embed | Local after first download |
| ~100ms latency per call (network) | ~30ms per call (CPU) |

---

## Setup for ALL Developers (One-Time)

### Prerequisites
- Python 3.11+ with the project venv activated
- No HuggingFace account needed — the model is public

### Steps

**1. Install new dependencies**
```bash
pip install -r requirements.txt
```
This installs two new packages: `langchain-huggingface` and `sentence-transformers`.

**2. Delete `chroma_data/` directory**
```bash
# Windows
rmdir /s /q chroma_data

# macOS / Linux
rm -rf chroma_data
```
> **Why?** The old ChromaDB collections used 1536-dimension vectors (OpenAI). The new model produces 768-dimension vectors. Mixing dimensions will crash. This is a one-time reset.

**3. Add environment variables to your `.env`**

Add this line to your `.env` file (optional — the default is already `BAAI/bge-base-en-v1.5`):
```env
HF_EMBEDDING_MODEL=BAAI/bge-base-en-v1.5
```

That's it. `OPENAI_API_KEY` is still required (for GPT-4o chat + Whisper).

**4. Start the app normally**

```bash
python main.py
# or
uvicorn app.main:app --reload
```

On the **first startup**, `sentence-transformers` will download the model (~110MB) to `~/.cache/huggingface/`. You'll see console output like:

```
Downloading model: BAAI/bge-base-en-v1.5
[RAG] Engine initialized — Embeddings: HuggingFace local (BAAI/bge-base-en-v1.5), Chat: gpt-4o
```

After the first download, the model is cached on disk forever — no network needed.

**5. Re-ingest your documents**

Since ChromaDB was cleared, go to the AI Brain in the UI and re-upload any documents your team had. They'll be embedded with the new local model.

---

## Configuration Reference

| Env Variable | Default (in code) | Description |
|---|---|---|
| `HF_EMBEDDING_MODEL` | `"BAAI/bge-base-en-v1.5"` | HuggingFace model name for embeddings |
| `OPENAI_API_KEY` | `""` | Still required for GPT-4o chat and Whisper |

---

## Files Changed

| File | What Changed |
|---|---|
| `app/core/config.py` | Removed `EMBEDDING_PROVIDER` and `RAG_EMBEDDING_MODEL`; kept `HF_EMBEDDING_MODEL` |
| `app/rag/engine.py` | Embeddings always use `HuggingFaceEmbeddings`. No OpenAI embedding code. Chat LLM unchanged (GPT-4o). |
| `requirements.txt` | Added `langchain-huggingface` and `sentence-transformers` |
| `.env.example` | Added `HF_EMBEDDING_MODEL` |
| `app/rag/__init__.py` | Updated docstring to mention configurable embeddings |

**NOT changed**: `meetings.py`, `timeline.py`, `processor.py`, `prompts.py`, all frontend, all database/migrations.

---

## About the Model: BAAI/bge-base-en-v1.5

- **Full name**: Beijing Academy of Artificial Intelligence — General Embedding base v1.5
- **Parameters**: ~110M (110MB download)
- **Dimensions**: 768
- **License**: MIT (fully open, commercial use OK)
- **MTEB benchmark**: Top-tier for its size class
- **Device**: Runs on CPU — no GPU required
- **Language**: English-optimized (good enough for mixed-language project notes)
- **HuggingFace page**: https://huggingface.co/BAAI/bge-base-en-v1.5

---

## Troubleshooting

**Q: I get a dimension mismatch error from ChromaDB**
A: Delete the `chroma_data/` folder and restart. You likely have old 1536-dim vectors.

**Q: The first startup is slow**
A: The model is downloading (~110MB). Check your internet connection. After that it's cached.

**Q: Can I use a different HuggingFace embedding model?**
A: Yes — set `HF_EMBEDDING_MODEL` to any model supported by `sentence-transformers`. But you must delete `chroma_data/` when switching models (dimension change). Some options:
- `BAAI/bge-small-en-v1.5` — smaller (33MB), 384-dim, slightly less accurate
- `BAAI/bge-large-en-v1.5` — larger (335MB), 1024-dim, more accurate
- `sentence-transformers/all-MiniLM-L6-v2` — classic lightweight (22MB), 384-dim

**Q: Do I need a HuggingFace account or token?**
A: No. `BAAI/bge-base-en-v1.5` is a public model. `sentence-transformers` downloads it anonymously.
