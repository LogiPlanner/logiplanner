"""
RAG Engine
==========
The core orchestration layer for the LogiPlanner AI Brain.

Responsibilities:
- Manages ChromaDB persistent vector store (per-team collections)
- Handles document embedding via OpenAI text-embedding-3-small
- Performs similarity search with metadata filtering
- Orchestrates chat responses via GPT-4o with retrieval context
- Provides knowledge base statistics

Usage:
    from app.rag.engine import rag_engine
    
    # Ingest documents
    chunk_count = rag_engine.ingest_chunks(team_id, processed_chunks)
    
    # Query
    response = rag_engine.chat(team_id, user_query, chat_history)
    
    # Stats
    stats = rag_engine.get_stats(team_id)
"""

import json
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_chroma import Chroma
from langchain_core.documents import Document as LCDocument
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from app.core.config import settings
from app.rag.prompts import SYSTEM_PROMPT, CONTEXT_TEMPLATE, NO_CONTEXT_RESPONSE, SOURCE_CITATION_TEMPLATE


class RAGEngine:
    """
    Singleton RAG engine that manages the full retrieval-augmented generation pipeline.
    
    Key design decisions:
    - Per-team ChromaDB collections for data isolation
    - Persistent storage at ./chroma_data/ (survives server restarts)
    - OpenAI embeddings for high-quality semantic search
    - GPT-4o for chat responses with source citations
    """

    def __init__(self):
        self._chroma_client = None
        self._embeddings = None
        self._llm = None
        self._initialized = False

    def _ensure_initialized(self):
        """Lazy initialization — only connects to ChromaDB and OpenAI when first needed."""
        if self._initialized:
            return

        if not settings.OPENAI_API_KEY:
            raise RuntimeError(
                "OPENAI_API_KEY is not set in .env. "
                "The RAG system requires an OpenAI API key for embeddings and chat."
            )

        # ChromaDB persistent client
        self._chroma_client = chromadb.PersistentClient(
            path=settings.CHROMA_PERSIST_DIR,
            settings=ChromaSettings(
                anonymized_telemetry=False,
            ),
        )

        # OpenAI embeddings
        self._embeddings = OpenAIEmbeddings(
            model=settings.RAG_EMBEDDING_MODEL,
            openai_api_key=settings.OPENAI_API_KEY,
        )

        # OpenAI chat model
        self._llm = ChatOpenAI(
            model=settings.RAG_CHAT_MODEL,
            openai_api_key=settings.OPENAI_API_KEY,
            temperature=0.3,  # Low temperature for factual, grounded responses
            max_tokens=2000,
        )

        self._initialized = True
        print(f"[RAG] Engine initialized — ChromaDB: {settings.CHROMA_PERSIST_DIR}, "
              f"Embedding: {settings.RAG_EMBEDDING_MODEL}, Chat: {settings.RAG_CHAT_MODEL}")

    def _get_collection_name(self, team_id: int) -> str:
        """Generate a collection name for a team. Each team gets its own isolated collection."""
        return f"team_{team_id}_knowledge"

    def _get_vectorstore(self, team_id: int) -> Chroma:
        """Get or create a Chroma vectorstore for a specific team."""
        self._ensure_initialized()
        collection_name = self._get_collection_name(team_id)

        return Chroma(
            client=self._chroma_client,
            collection_name=collection_name,
            embedding_function=self._embeddings,
        )

    def _invoke_llm_with_retry(self, messages, max_retries: int = 3):
        """Invoke chat model with small retry/backoff for transient connection failures."""
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                return self._llm.invoke(messages)
            except Exception as e:
                last_error = e
                err_name = e.__class__.__name__.lower()
                err_text = str(e).lower()
                is_transient = (
                    "connection" in err_name or
                    "timeout" in err_name or
                    "rate" in err_name or
                    "connection" in err_text or
                    "timeout" in err_text or
                    "tempor" in err_text or
                    "try again" in err_text
                )

                print(f"[RAG] Chat invoke failed (attempt {attempt}/{max_retries}): {e.__class__.__name__}: {e}")

                if not is_transient or attempt == max_retries:
                    raise

                # Lightweight exponential backoff: 1s, 2s, 4s
                time.sleep(2 ** (attempt - 1))

        raise last_error

    # ──────────────────────────────────────────────
    # INGESTION
    # ──────────────────────────────────────────────

    def ingest_chunks(self, team_id: int, chunks: List[LCDocument]) -> int:
        """
        Ingest pre-processed chunks into the team's ChromaDB collection.
        
        Args:
            team_id: The team this document belongs to
            chunks: List of LangChain Documents with enriched metadata
            
        Returns:
            Number of chunks successfully ingested
        """
        if not chunks:
            return 0

        self._ensure_initialized()
        vectorstore = self._get_vectorstore(team_id)

        # Convert metadata values to ChromaDB-compatible types (strings/ints/floats only)
        for chunk in chunks:
            for key, value in chunk.metadata.items():
                if isinstance(value, (list, dict)):
                    chunk.metadata[key] = json.dumps(value)
                elif value is None:
                    chunk.metadata[key] = ""

        # Add documents to vectorstore
        vectorstore.add_documents(chunks)

        print(f"[RAG] Ingested {len(chunks)} chunks into team_{team_id}_knowledge")
        return len(chunks)

    def delete_document_chunks(self, team_id: int, document_id: int) -> int:
        """
        Delete all chunks belonging to a specific document from the vector store.
        
        Args:
            team_id: Team ID
            document_id: The document whose chunks to delete
            
        Returns:
            Number of chunks deleted
        """
        self._ensure_initialized()
        collection_name = self._get_collection_name(team_id)

        try:
            collection = self._chroma_client.get_collection(collection_name)
            # Get all chunks for this document
            results = collection.get(
                where={"document_id": document_id},
            )
            if results and results["ids"]:
                collection.delete(ids=results["ids"])
                count = len(results["ids"])
                print(f"[RAG] Deleted {count} chunks for document {document_id} from team {team_id}")
                return count
        except Exception as e:
            print(f"[RAG] Error deleting chunks: {e}")

        return 0

    # ──────────────────────────────────────────────
    # RETRIEVAL & CHAT
    # ──────────────────────────────────────────────

    def search(
        self,
        team_id: int,
        query: str,
        k: int = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[LCDocument]:
        """
        Perform similarity search on a team's knowledge base.
        
        Args:
            team_id: Team to search in
            query: The search query
            k: Number of results to return
            filters: Optional metadata filters (e.g., {"doc_type": "pdf"})
            
        Returns:
            List of relevant document chunks with metadata
        """
        k = k or settings.RAG_TOP_K
        vectorstore = self._get_vectorstore(team_id)

        search_kwargs = {"k": k}
        if filters:
            search_kwargs["filter"] = filters

        try:
            results = vectorstore.similarity_search(query, **search_kwargs)
            return results
        except Exception as e:
            print(f"[RAG] Search error: {e}")
            return []

    def chat(
        self,
        team_id: int,
        query: str,
        chat_history: Optional[List[Dict[str, str]]] = None,
        filters: Optional[Dict[str, Any]] = None,
        live_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Full RAG chat pipeline:
        1. Retrieve relevant chunks from the team's knowledge base
        2. Assemble context with source information
        3. Send to GPT-4o with system prompt + context + history
        4. Return response with source citations
        
        Args:
            team_id: Team to query
            query: User's question
            chat_history: Previous messages [{"role": "user/assistant", "content": "..."}]
            filters: Optional metadata filters
            
        Returns:
            {
                "response": "AI response text",
                "sources": [{"filename": "...", "page": 1, "uploader": "..."}],
                "chunk_count": 5
            }
        """
        self._ensure_initialized()

        # Step 1: Retrieve relevant chunks
        relevant_chunks = self.search(team_id, query, filters=filters)

        # Step 2 & 3: Assemble context from chunks
        context_parts = []
        sources = []
        seen_sources = set()

        if not relevant_chunks:
            context = "[NO RELEVANT DOCUMENTS FOUND IN KNOWLEDGE BASE]"
        else:
            for i, chunk in enumerate(relevant_chunks):
                meta = chunk.metadata
                context_parts.append(
                    f"[Source {i+1}: {meta.get('filename', 'Unknown')} "
                    f"(Page {meta.get('page_number', '?')})]\n{chunk.page_content}"
                )

                # Collect unique sources
                source_key = f"{meta.get('filename', '')}_{meta.get('page_number', 0)}"
                if source_key not in seen_sources:
                    seen_sources.add(source_key)
                    sources.append({
                        "filename": meta.get("filename", "Unknown"),
                        "page_number": meta.get("page_number", 0),
                        "uploader": meta.get("uploader_email", "Unknown"),
                        "doc_type": meta.get("doc_type", "unknown"),
                        "chunk_index": meta.get("chunk_index", 0),
                    })
            context = "\n\n---\n\n".join(context_parts)

        if live_context:
            sources.append({
                "filename": "Live Workspace Context",
                "page_number": 0,
                "uploader": "system",
                "doc_type": "live_context",
                "chunk_index": 0,
            })

        # Step 4: Build message chain
        messages = [SystemMessage(content=SYSTEM_PROMPT)]

        # Add chat history (last 10 exchanges max)
        if chat_history:
            for msg in chat_history[-20:]:  # 10 exchanges = 20 messages
                if msg["role"] == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    messages.append(AIMessage(content=msg["content"]))

        # Add the contextual query
        contextual_query = CONTEXT_TEMPLATE.format(
            context=context,
            live_context=live_context or "[NO LIVE WORKSPACE CONTEXT PROVIDED]",
            question=query,
        )
        messages.append(HumanMessage(content=contextual_query))

        # Step 5: Generate response
        try:
            response = self._invoke_llm_with_retry(messages)
            response_text = response.content
        except Exception as e:
            print(f"[RAG] Chat error (final): {e.__class__.__name__}: {e}")
            response_text = f"I encountered an error while processing your question. Please try again. Error: {str(e)}"

        return {
            "response": response_text,
            "sources": sources,
            "chunk_count": len(relevant_chunks),
        }

    # ──────────────────────────────────────────────
    # STATISTICS
    # ──────────────────────────────────────────────

    def get_stats(self, team_id: int) -> Dict[str, Any]:
        """
        Get knowledge base statistics for a team.
        
        Returns:
            {
                "total_chunks": int,
                "document_count": int,
                "doc_types": {"pdf": 3, "docx": 1, ...},
                "recent_uploads": [{"filename": ..., "uploaded_at": ...}]
            }
        """
        self._ensure_initialized()
        collection_name = self._get_collection_name(team_id)

        try:
            collection = self._chroma_client.get_collection(collection_name)
            total = collection.count()

            # Get all metadata for analysis
            if total > 0:
                all_data = collection.get(include=["metadatas"])
                metadatas = all_data.get("metadatas", [])

                # Count unique documents and doc types
                doc_ids = set()
                doc_types = {}
                recent = []

                for meta in metadatas:
                    doc_id = meta.get("document_id")
                    if doc_id:
                        doc_ids.add(doc_id)

                    dtype = meta.get("doc_type", "unknown")
                    doc_types[dtype] = doc_types.get(dtype, 0) + 1

                return {
                    "total_chunks": total,
                    "document_count": len(doc_ids),
                    "doc_types": doc_types,
                    "collection_name": collection_name,
                }
            else:
                return {
                    "total_chunks": 0,
                    "document_count": 0,
                    "doc_types": {},
                    "collection_name": collection_name,
                }

        except Exception:
            # Collection doesn't exist yet
            return {
                "total_chunks": 0,
                "document_count": 0,
                "doc_types": {},
                "collection_name": collection_name,
            }

    def collection_exists(self, team_id: int) -> bool:
        """Check if a team has a knowledge base collection."""
        self._ensure_initialized()
        collection_name = self._get_collection_name(team_id)
        try:
            col = self._chroma_client.get_collection(collection_name)
            return col.count() > 0
        except Exception:
            return False


# ─── Singleton instance ───
# Import this in your API routes: `from app.rag.engine import rag_engine`
rag_engine = RAGEngine()
