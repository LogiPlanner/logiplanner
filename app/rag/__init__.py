"""
LogiPlanner RAG (Retrieval-Augmented Generation) System
=====================================================

This package contains the complete RAG pipeline for the AI Brain feature:

- engine.py    → RAG engine (ChromaDB + OpenAI + LangChain orchestration)
- processor.py → Document loading, splitting, and metadata enrichment
- prompts.py   → System prompts and prompt templates for AI chat

Architecture:
  Upload → Processor (load → split → enrich metadata) → Engine (embed → store in ChromaDB)
  Query  → Engine (retrieve from ChromaDB → assemble context → GPT-4o) → Response with sources
"""
